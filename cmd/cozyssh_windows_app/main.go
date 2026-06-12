//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"github.com/gogpu/systray"
	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"cozyssh"
	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/constants"
)

// AppConfig holds desktop-specific window settings, saved to app-config.json.
type AppConfig struct {
	// Width and Height are the window dimensions when not maximized.
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

// ---- Win32 helpers --------------------------------------------------------

var (
	user32dll            = windows.NewLazySystemDLL("user32.dll")
	procShowWindow       = user32dll.NewProc("ShowWindow")
	procGetWindowRect    = user32dll.NewProc("GetWindowRect")
	procIsZoomed         = user32dll.NewProc("IsZoomed")
	procSendMessage      = user32dll.NewProc("SendMessageW")
	procRedrawWindow     = user32dll.NewProc("RedrawWindow")
	procGetSystemMetrics = user32dll.NewProc("GetSystemMetrics")
	procIsIconic         = user32dll.NewProc("IsIconic")
	procIsWindowVisible  = user32dll.NewProc("IsWindowVisible")

	procGetWindowLong     = user32dll.NewProc("GetWindowLongW")
	procSetWindowLong     = user32dll.NewProc("SetWindowLongW")
	procSetWindowPos      = user32dll.NewProc("SetWindowPos")
	procGetMonitorInfo    = user32dll.NewProc("GetMonitorInfoW")
	procMonitorFromWindow = user32dll.NewProc("MonitorFromWindow")

	procSetWindowLongPtr = user32dll.NewProc("SetWindowLongPtrW")
	procCallWindowProc   = user32dll.NewProc("CallWindowProcW")

	procPeekMessage      = user32dll.NewProc("PeekMessageW")
	procTranslateMessage = user32dll.NewProc("TranslateMessage")
	procDispatchMessage  = user32dll.NewProc("DispatchMessageW")

	ole32dll           = windows.NewLazySystemDLL("ole32.dll")
	procCoInitialize   = ole32dll.NewProc("CoInitializeEx")
	procCoUninitialize = ole32dll.NewProc("CoUninitialize")

	// Index for overriding the window message function
	gwlpWndProc = -4

	// Defining this as a variable bypasses compile-time unsigned constant checks
	gwlStyle = -16
)

type winRect struct{ Left, Top, Right, Bottom int32 }

const (
	swShowNormal    = 1
	swShowMaximized = 3

	wmSetRedraw = 0x000B

	rdwErase       = 0x0004
	rdwFrame       = 0x0400
	rdwInvalidate  = 0x0001
	rdwAllChildren = 0x0080

	smCxScreen = 0
	smCyScreen = 1

	wsOverlappedWindow      uint32 = 0x00CF0000
	wsPopup                 uint32 = 0x80000000
	swpFrameChanged                = 0x0020
	swpShowWindow                  = 0x0040
	monitorDefaultToNearest        = 2

	swHide    = 0
	swShow    = 5
	wmClose   = 0x0010
	wmDestroy = 0x0002

	pmRemove = 0x0001
)

// A global reference to track the original window processing loop
var originalWndProc uintptr

type monitorInfo struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
}

func isMinimized(hwnd uintptr) bool {
	ret, _, _ := procIsIconic.Call(hwnd)
	return ret != 0
}

func isVisible(hwnd uintptr) bool {
	ret, _, _ := procIsWindowVisible.Call(hwnd)
	return ret != 0
}

// windowState returns the outer pixel size of the window and whether it is
// currently maximized. Returns 0,0,false if the HWND is invalid.
func windowState(hwnd uintptr) (width, height int, maximized bool) {
	var r winRect
	ret, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	if ret == 0 {
		return 0, 0, false
	}
	z, _, _ := procIsZoomed.Call(hwnd)
	return int(r.Right - r.Left), int(r.Bottom - r.Top), z != 0
}

// ---- App config persistence -----------------------------------------------

func loadAppConfig(cfgDir string) *AppConfig {
	data, err := os.ReadFile(filepath.Join(cfgDir, constants.APP_CONFIG_FILE))
	if err != nil {
		return nil
	}
	var ac AppConfig
	if err := json.Unmarshal(data, &ac); err != nil {
		return nil
	}
	// Discard configurations with unreasonably small dimensions (e.g. from previous bugs)
	if ac.Width < constants.APP_MIN_WIDTH || ac.Height < constants.APP_MIN_HEIGHT {
		return nil
	}
	return &ac
}

func saveAppConfig(cfgDir string, ac *AppConfig) {
	common.AtomicWriteFile(filepath.Join(cfgDir, constants.APP_CONFIG_FILE), func(writer io.Writer) error {
		return json.NewEncoder(writer).Encode(ac)
	})
}

// ---- Main -----------------------------------------------------------------

func main() {
	// Desktop (windowsgui) build has no console; write initial password to file.
	config.SetWritePasswordToFile(true)

	// Load config to discover the server address and data directory.
	// cozyssh.Run loads it again internally — harmless.
	cfg, err := config.LoadConfig("")
	if err != nil {
		showFatalDialog("CozySSH startup error", fmt.Sprintf("Failed to load config: %v", err))
		os.Exit(1)
	}

	// FAST ZERO-DELAY DETECTION
	// Try connecting to the local address. A local network dial takes virtually 0ms.
	isServerRunning := false
	dialer := net.Dialer{Timeout: 15 * time.Millisecond}
	if conn, err := dialer.Dial("tcp", cfg.Addr); err == nil {
		conn.Close()
		isServerRunning = true
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serverErr := make(chan error, 1)

	if !isServerRunning {
		// First instance: Start background engine routines normally
		readyChan := make(chan string, 1)
		go func() { serverErr <- cozyssh.Run(ctx, os.Args[1:], readyChan) }()

		select {
		case err := <-serverErr:
			showFatalDialog("CozySSH startup error", fmt.Sprintf("Server exited early: %v", err))
			os.Exit(1)
		case <-readyChan:
			// Port successfully opened by our core system loop
		}
	}

	// Normalize the address
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		host, port = "127.0.0.1", "8022"
	} else if host == "0.0.0.0" || host == "::" || host == "" {
		host = "127.0.0.1"
	}
	serverURL := "http://" + net.JoinHostPort(host, port)

	initWidth, initHeight, startMaximized, _ := GetWindowSize(cfg)

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     true, // allow F12 DevTools
		AutoFocus: true,
		// the default data path is volatile that some data like page zoom level doesn't persist across restarts.
		DataPath: filepath.Join(cfg.ConfigDir, constants.WEBVIEW2_DATA_DIR),
		WindowOptions: webview2.WindowOptions{
			Title:     constants.APP_NAME,
			Width:     initWidth,
			Height:    initHeight,
			IconId:    1,
			Center:    true,
			Maximized: startMaximized,
		},
	})
	if w == nil {
		showFatalDialog("CozySSH startup error",
			"Failed to create WebView2 window.\nMake sure the Microsoft Edge WebView2 Runtime is installed.")
		os.Exit(1)
	}
	defer w.Destroy()

	hwnd := uintptr(w.Window())

	var isFullscreen bool
	var savedWindowRect winRect
	var savedWindowStyle uint32 // FIX: Changed from int32 to uint32

	w.Bind("appToggleFullscreen", func() {
		w.Dispatch(func() {
			if !isFullscreen {
				// 1. Save current window placement and style flags
				style, _, _ := procGetWindowLong.Call(hwnd, uintptr(gwlStyle))
				savedWindowStyle = uint32(style) // Safely cast the uintptr return value to uint32
				procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&savedWindowRect)))

				// 2. Identify the current monitor's dimensions
				monitor, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultToNearest)
				var mi monitorInfo
				mi.CbSize = uint32(unsafe.Sizeof(mi))
				procGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&mi)))

				// 3. Strip window borders and title bars (convert to popup style) using uint32 calculations
				newStyle := uintptr(savedWindowStyle & ^wsOverlappedWindow | wsPopup)
				procSetWindowLong.Call(hwnd, uintptr(gwlStyle), newStyle)

				// 4. Stretch window across the absolute monitor bounds
				width := mi.RcMonitor.Right - mi.RcMonitor.Left
				height := mi.RcMonitor.Bottom - mi.RcMonitor.Top
				procSetWindowPos.Call(hwnd, 0,
					uintptr(mi.RcMonitor.Left), uintptr(mi.RcMonitor.Top),
					uintptr(width), uintptr(height),
					swpFrameChanged|swpShowWindow,
				)
				isFullscreen = true
			} else {
				// 5. Revert back to original window decorations and bounds
				procSetWindowLong.Call(hwnd, uintptr(gwlStyle), uintptr(savedWindowStyle))
				width := savedWindowRect.Right - savedWindowRect.Left
				height := savedWindowRect.Bottom - savedWindowRect.Top
				procSetWindowPos.Call(hwnd, 0,
					uintptr(savedWindowRect.Left), uintptr(savedWindowRect.Top),
					uintptr(width), uintptr(height),
					swpFrameChanged|swpShowWindow,
				)
				isFullscreen = false
			}
		})
	})

	w.Bind("appOpenNewWindow", func(targetURL string) {
		go func() {
			runtime.LockOSThread()
			defer runtime.UnlockOSThread()

			// 1. Explicitly bind this thread to a Win32 Single-Threaded Apartment (STA)
			// 0x2 = COINIT_APARTMENTTHREADED, 0x4 = COINIT_DISABLE_OLE1DDE
			procCoInitialize.Call(0, 0x2|0x4)
			defer procCoUninitialize.Call()

			width, height, maximized, _ := GetWindowSize(cfg)
			subW := webview2.NewWithOptions(webview2.WebViewOptions{
				AutoFocus: true,
				DataPath:  filepath.Join(cfg.ConfigDir, constants.WEBVIEW2_DATA_DIR),
				WindowOptions: webview2.WindowOptions{
					Title:     constants.APP_NAME,
					Width:     width,
					Height:    height,
					IconId:    1,
					Maximized: maximized,
					Center:    true,
				},
			})
			if subW == nil {
				return
			}

			subW.Navigate(targetURL)

			// Blocks here while the secondary window is open
			subW.Run()

			// 2. The window loop ended, cleanly destroy the local webview controller structures
			subW.Destroy()

			// 3. LINGERING MESSAGE PUMP
			// Run a short, dedicated loop to drain any remaining detachment messages
			// sent by the Edge browser process before letting the thread die completely.
			var msg struct {
				Hwnd    uintptr
				Message uint32
				WParam  uintptr
				LParam  uintptr
				Time    uint32
				Pt      struct{ X, Y int32 }
			}

			endTime := time.Now().Add(150 * time.Millisecond)
			for time.Now().Before(endTime) {
				// PeekMessageW(&msg, hwnd=0, msgMin=0, msgMax=0, PM_REMOVE)
				ret, _, _ := procPeekMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, pmRemove)
				if ret != 0 {
					procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
					procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
				} else {
					// Queue is empty, yield to the OS briefly
					time.Sleep(2 * time.Millisecond)
				}
			}
		}()
	})

	var tray *systray.SystemTray
	if !isServerRunning {
		// SETUP THE SYSTEM TRAY
		// We instantiate the tray on the main thread, but DO NOT call tray.Run().
		// WebView2's native window event loop will automatically pump messages for the tray.
		tray = systray.New()

		// Note: Replace with your actual embedded icon bytes
		iconBytes, _ := cozyssh.FrontendFS.ReadFile("frontend/dist/favicon.png")
		tray.SetIcon(iconBytes).SetTooltip(constants.APP_NAME + " Background Service").Show()

		// Build the tray menu interactions
		menu := systray.NewMenu()
		onClick := func() {
			w.Dispatch(func() {
				procShowWindow.Call(hwnd, uintptr(swShow))
			})
		}
		menu.Add("Open "+constants.APP_NAME, onClick)
		menu.AddSeparator()
		menu.Add("Quit", func() {
			w.Terminate()
		})
		tray.SetMenu(menu)
		tray.OnClick(onClick)

		// INJECT THE WIN32 WINDOW CLOSE HOOK
		// Swap the native window handler with our interceptor logic
		newCallback := syscall.NewCallback(windowProc)
		oldProc, _, _ := procSetWindowLongPtr.Call(hwnd, uintptr(gwlpWndProc), newCallback)
		originalWndProc = oldProc
	}

	w.Navigate(serverURL + "/")

	// Poll window state every second and persist changes.
	// We track the last *non-maximized* dimensions separately so that when
	// the user maximizes the window, we don't overwrite the restore size.
	lastNonMaxW, lastNonMaxH := constants.APP_DEFAULT_WIDTH, constants.APP_DEFAULT_HEIGHT

	stopPoll := make(chan struct{})
	go func() {
		var prevW, prevH int
		var prevMax bool
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopPoll:
				return
			case <-ticker.C:
				if isMinimized(hwnd) || !isVisible(hwnd) {
					continue
				}
				cw, ch, cmax := windowState(hwnd)
				// Prevent saving if the window rect is invalid or too small
				if cw < 400 || ch < 300 {
					continue
				}
				if cw == prevW && ch == prevH && cmax == prevMax {
					continue
				}
				prevW, prevH, prevMax = cw, ch, cmax
				if !cmax {
					lastNonMaxW, lastNonMaxH = cw, ch
				}
				saveAppConfig(cfg.ConfigDir, &AppConfig{
					Width:     lastNonMaxW,
					Height:    lastNonMaxH,
					Maximized: cmax,
				})
			}
		}
	}()

	// Blocking message loop — returns when the window is closed.
	w.Run()
	close(stopPoll)
	if tray != nil {
		tray.Remove() // Remove icon from the taskbar notification area
	}

	cancel()
	select {
	case err := <-serverErr:
		if err != nil && err != context.Canceled {
			_ = err
		}
	case <-time.After(3 * time.Second):
	}
}

// showFatalDialog displays an error in a small WebView2 window.
// Used because this binary has no console (-H windowsgui).
func showFatalDialog(title, message string) {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		WindowOptions: webview2.WindowOptions{
			Title:  title,
			Width:  480,
			Height: 200,
			Center: true,
		},
	})
	if w == nil {
		return
	}
	defer w.Destroy()
	w.SetHtml(fmt.Sprintf(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px">
<h3 style="color:#c00">%s</h3><p>%s</p>
<button onclick="window.close()">Close</button></body></html>`, title, message))
	w.Run()
}

func windowProc(hwnd uintptr, msg uint32, wparam uintptr, lparam uintptr) uintptr {
	if msg == wmClose {
		// User clicked "X"! Intercept the signal and hide the window instead of closing it
		procShowWindow.Call(hwnd, uintptr(swHide))
		return 0
	}
	// Route all other UI window messages (resize, paint, drag) back to WebView2
	ret, _, _ := procCallWindowProc.Call(originalWndProc, hwnd, uintptr(msg), wparam, lparam)
	return ret
}

func GetWindowSize(cfg *config.Config) (width uint, height uint, maximized bool, firstRun bool) {
	appCfg := loadAppConfig(cfg.ConfigDir)
	if appCfg == nil {
		return constants.APP_DEFAULT_WIDTH, constants.APP_DEFAULT_HEIGHT, true, true
	}
	return uint(appCfg.Width), uint(appCfg.Height), appCfg.Maximized, false
}

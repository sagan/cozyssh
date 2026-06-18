//go:build windows

package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/gogpu/systray"
	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"cozyssh"
	"cozyssh/auth"
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
	wmSetIcon   = 0x0080
	iconSmall   = 0
	iconBig     = 1
	imageIcon   = 1

	rdwErase       = 0x0004
	rdwFrame       = 0x0400
	rdwInvalidate  = 0x0001
	rdwAllChildren = 0x0080

	smCxScreen = 0
	smCyScreen = 1

	smCxIcon   = 11
	smCyIcon   = 12
	smCxSmIcon = 49
	smCySmIcon = 50

	lrDefaultSize = 0x0040
	lrShared      = 0x8000

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

	// Icon resource ID assigned by rsrc tool (manifest=1, group_icon=2)
	appIconResourceId = 2
)

// Global state sync orchestration references
var (
	originalWndProc uintptr
	trayInstance    *systray.SystemTray
)

type monitorInfo struct {
	CbSize    uint32
	RcMonitor winRect
	RcWork    winRect
	DwFlags   uint32
}

type uiReferences struct {
	w    webview2.WebView
	hwnd uintptr
}

func isMinimized(hwnd uintptr) bool {
	ret, _, _ := procIsIconic.Call(hwnd)
	return ret != 0
}

func isVisible(hwnd uintptr) bool {
	ret, _, _ := procIsWindowVisible.Call(hwnd)
	return ret != 0
}

// setWindowIcon loads the app icon from the embedded resource and sets it on
// the window via WM_SETICON for both the title bar (ICON_SMALL) and taskbar
// (ICON_BIG). This is more reliable than relying on the window class icon alone.
func setWindowIcon(hwnd uintptr) {
	var hinstance windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &hinstance)

	// Load big icon (typically 32x32, for taskbar / Alt-Tab)
	bigCx, _, _ := procGetSystemMetrics.Call(uintptr(smCxIcon))
	bigCy, _, _ := procGetSystemMetrics.Call(uintptr(smCyIcon))
	bigIcon, _, _ := user32dll.NewProc("LoadImageW").Call(
		uintptr(hinstance), uintptr(appIconResourceId), imageIcon,
		bigCx, bigCy, lrShared,
	)
	if bigIcon != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, iconBig, bigIcon)
	}

	// Load small icon (typically 16x16, for title bar)
	smCx, _, _ := procGetSystemMetrics.Call(uintptr(smCxSmIcon))
	smCy, _, _ := procGetSystemMetrics.Call(uintptr(smCySmIcon))
	smallIcon, _, _ := user32dll.NewProc("LoadImageW").Call(
		uintptr(hinstance), uintptr(appIconResourceId), imageIcon,
		smCx, smCy, lrShared,
	)
	if smallIcon != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, iconSmall, smallIcon)
	}
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
	flags := cozyssh.ParseFlags(os.Args[1:])
	if flags.DoResetPassword || flags.Err == flag.ErrHelp {
		// CLI mode
		attachToParentConsole()
		flags = cozyssh.ParseFlags(os.Args[1:]) // parse again since stdout changed so it can output help
		err := cozyssh.RunWithFlags(context.Background(), flags, nil)

		// Force flush to make sure everything hits the terminal screen
		os.Stdout.Sync()
		// Send the mock keystroke to force a fresh prompt line down below
		releaseConsoleCleanly()

		if err != nil && err != context.Canceled {
			os.Exit(1)
		} else {
			os.Exit(0)
		}
	}

	// Desktop (windowsgui) build has no console; write initial password to file.
	config.SetWritePasswordToFile(true)

	// Load config to discover the server address and data directory.
	cfg, err := config.LoadConfig("")
	if err != nil {
		messageBox("CozySSH startup error", fmt.Sprintf("Failed to load config: %v", err))
		os.Exit(1)
	}

	// 1. Initialize Leader Election Mutex
	mutexName, err := windows.UTF16PtrFromString("Local\\CozySSH_Mutex_" + strings.ReplaceAll(cfg.ConfigDir, "\\", "_"))
	if err != nil {
		fmt.Printf("Error creating mutex name: %v\n", err)
		os.Exit(1)
	}
	mutexHandle, err := windows.CreateMutex(nil, false, mutexName)
	// FIX: Explicitly bypass the ERROR_ALREADY_EXISTS error since it means the object exists successfully
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		fmt.Printf("Failed to create mutex: %v\n", err)
		os.Exit(1)
	}
	defer windows.CloseHandle(mutexHandle)

	// 2. Initialize Readiness Cross-Process Event (Manual Reset, Unsignaled initially)
	eventName, err := windows.UTF16PtrFromString("Local\\CozySSH_Event_" + strings.ReplaceAll(cfg.ConfigDir, "\\", "_"))
	if err != nil {
		fmt.Printf("Error creating event name: %v\n", err)
		os.Exit(1)
	}
	eventHandle, err := windows.CreateEvent(nil, 1, 0, eventName)
	// FIX: Explicitly bypass the ERROR_ALREADY_EXISTS error since it means the object exists successfully
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		fmt.Printf("Failed to create event: %v\n", err)
		os.Exit(1)
	}
	defer windows.CloseHandle(eventHandle)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serverErr := make(chan error, 1)

	// Channel to safely pass UI window pointers to the background failover thread
	uiReady := make(chan uiReferences, 1)

	// 3. Launch pure kernel-level background manager handling failovers (0% CPU idle overhead)
	go func() {
		// This blocks entirely in the OS kernel until the mutex becomes free
		event, err := windows.WaitForSingleObject(mutexHandle, windows.INFINITE)
		if err != nil {
			return
		}

		if event == windows.WAIT_OBJECT_0 || event == windows.WAIT_ABANDONED {
			serverCtx, serverCancel := context.WithCancel(ctx)
			defer serverCancel()

			readyChan := make(chan string, 1)
			go func() { serverErr <- cozyssh.RunWithFlags(serverCtx, flags, readyChan) }()

			select {
			case <-ctx.Done():
				return
			case err := <-serverErr:
				messageBox("CozySSH startup error", fmt.Sprintf("Server exited early: %v", err))
				os.Exit(1)
			case <-readyChan:
				// Engine server port opened successfully
			}

			// Latch cross-process event open to unblock any future or launching UIs
			windows.SetEvent(eventHandle)

			// Wait until local WebView2 parameters are safely generated on the main thread
			ui := <-uiReady

			// Inject tray and window handler interceptions onto running UI window thread
			ui.w.Dispatch(func() {
				setupSystemTrayAndHook(ui.w, ui.hwnd)
			})

			// Keep this background thread alive to maintain ownership of the Win32 Mutex
			<-ctx.Done()
			windows.ResetEvent(eventHandle)
			windows.ReleaseMutex(mutexHandle)
		}
	}()

	// 4. Block UI initialization completely until SOME instance has the engine ready
	for {
		state, _ := windows.WaitForSingleObject(eventHandle, 100)
		if state == windows.WAIT_OBJECT_0 {
			break
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
		DataPath:  filepath.Join(cfg.ConfigDir, constants.WEBVIEW2_DATA_DIR),
		WindowOptions: webview2.WindowOptions{
			Title:     constants.APP_NAME,
			Width:     initWidth,
			Height:    initHeight,
			IconId:    2, // RT_GROUP_ICON ID assigned by rsrc (manifest=1, group_icon=2)
			Center:    true,
			Maximized: startMaximized,
		},
	})
	if w == nil {
		messageBox("CozySSH startup error",
			"Failed to create WebView2 window.\nMake sure the Microsoft Edge WebView2 Runtime is installed.")
		os.Exit(1)
	}
	defer w.Destroy()

	hwnd := uintptr(w.Window())
	setWindowIcon(hwnd)

	// Push UI references into the buffered channel for the background manager
	uiReady <- uiReferences{w: w, hwnd: hwnd}

	var isFullscreen bool
	var savedWindowRect winRect
	var savedWindowStyle uint32

	w.Bind("appAuth", func() (string, error) {
		token := auth.GenerateToken()
		return token, nil
	})
	w.Bind("appToggleFullscreen", func() {
		w.Dispatch(func() {
			if !isFullscreen {
				style, _, _ := procGetWindowLong.Call(hwnd, uintptr(gwlStyle))
				savedWindowStyle = uint32(style)
				procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&savedWindowRect)))

				monitor, _, _ := procMonitorFromWindow.Call(hwnd, monitorDefaultToNearest)
				var mi monitorInfo
				mi.CbSize = uint32(unsafe.Sizeof(mi))
				procGetMonitorInfo.Call(monitor, uintptr(unsafe.Pointer(&mi)))

				newStyle := uintptr(savedWindowStyle & ^wsOverlappedWindow | wsPopup)
				procSetWindowLong.Call(hwnd, uintptr(gwlStyle), newStyle)

				width := mi.RcMonitor.Right - mi.RcMonitor.Left
				height := mi.RcMonitor.Bottom - mi.RcMonitor.Top
				procSetWindowPos.Call(hwnd, 0,
					uintptr(mi.RcMonitor.Left), uintptr(mi.RcMonitor.Top),
					uintptr(width), uintptr(height),
					swpFrameChanged|swpShowWindow,
				)
				isFullscreen = true
			} else {
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
					IconId:    2, // RT_GROUP_ICON ID assigned by rsrc (manifest=1, group_icon=2)
					Maximized: maximized,
					Center:    true,
				},
			})
			if subW == nil {
				return
			}

			subW.Navigate(targetURL)
			setWindowIcon(uintptr(subW.Window()))
			subW.Run()
			subW.Destroy()

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
				ret, _, _ := procPeekMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0, pmRemove)
				if ret != 0 {
					procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
					procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
				} else {
					time.Sleep(2 * time.Millisecond)
				}
			}
		}()
	})

	w.Navigate(serverURL + "/")

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

	w.Run()
	close(stopPoll)

	if trayInstance != nil {
		trayInstance.Remove()
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

// setupSystemTrayAndHook builds the tray interface and window procedures on the active leader.
func setupSystemTrayAndHook(w webview2.WebView, hwnd uintptr) {
	trayInstance = systray.New()

	iconBytes, _ := cozyssh.FrontendFS.ReadFile("frontend/dist/favicon.png")
	trayInstance.SetIcon(iconBytes).SetTooltip(constants.APP_NAME + " Background Service").Show()

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
	trayInstance.SetMenu(menu)
	trayInstance.OnClick(onClick)

	newCallback := syscall.NewCallback(windowProc)
	oldProc, _, _ := procSetWindowLongPtr.Call(hwnd, uintptr(gwlpWndProc), newCallback)
	originalWndProc = oldProc
}

func messageBox(title, message string) {
	textPtr, _ := windows.UTF16PtrFromString(message)
	titlePtr, _ := windows.UTF16PtrFromString(title)
	// Define the style flags (Combine buttons and icons using the bitwise OR '|' operator)
	// You can customize buttons (e.g., MB_YESNO) and icons (e.g., MB_ICONWARNING)
	boxType := windows.MB_OK | windows.MB_ICONINFORMATION
	// Trigger the native Windows Message Box
	// The first argument is the handle to the owner window. Passing 0 means no owner.
	windows.MessageBox(windows.HWND(0), textPtr, titlePtr, uint32(boxType))
}

func windowProc(hwnd uintptr, msg uint32, wparam uintptr, lparam uintptr) uintptr {
	if msg == wmClose {
		procShowWindow.Call(hwnd, uintptr(swHide))
		return 0
	}
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

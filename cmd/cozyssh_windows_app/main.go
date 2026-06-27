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
	"os/exec"
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

	// Additional procedures required for single-instance inter-process communication
	procPostMessage           = user32dll.NewProc("PostMessageW")
	procSetForegroundWindow   = user32dll.NewProc("SetForegroundWindow")
	procRegisterWindowMessage = user32dll.NewProc("RegisterWindowMessageW")

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

// Global state references
var (
	originalWndProc   uintptr
	trayInstance      *systray.SystemTray
	customActivateMsg uint32 // Registered dynamically per data directory
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
// (ICON_BIG).
func setWindowIcon(hwnd uintptr) {
	var hinstance windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &hinstance)

	bigCx, _, _ := procGetSystemMetrics.Call(uintptr(smCxIcon))
	bigCy, _, _ := procGetSystemMetrics.Call(uintptr(smCyIcon))
	bigIcon, _, _ := user32dll.NewProc("LoadImageW").Call(
		uintptr(hinstance), uintptr(appIconResourceId), imageIcon,
		bigCx, bigCy, lrShared,
	)
	if bigIcon != 0 {
		procSendMessage.Call(hwnd, wmSetIcon, iconBig, bigIcon)
	}

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
// currently maximized.
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
		flags = cozyssh.ParseFlags(os.Args[1:])
		err := cozyssh.RunWithFlags(context.Background(), flags, nil)

		os.Stdout.Sync()
		releaseConsoleCleanly()

		if err != nil && err != context.Canceled {
			os.Exit(1)
		} else {
			os.Exit(0)
		}
	}

	config.SetWritePasswordToFile(true)

	cfg, err := config.LoadConfig("")
	if err != nil {
		messageBox("CozySSH startup error", fmt.Sprintf("Failed to load config: %v", err))
		os.Exit(1)
	}

	// Register unique window message string for inter-process window activation
	msgName, err := windows.UTF16PtrFromString("CozySSH_Activate_" + strings.ReplaceAll(cfg.ConfigDir, "\\", "_"))
	if err == nil {
		regMsg, _, _ := procRegisterWindowMessage.Call(uintptr(unsafe.Pointer(msgName)))
		customActivateMsg = uint32(regMsg)
	}

	// 1. Initialize Global Named Mutex unique to this configuration directory
	mutexName, err := windows.UTF16PtrFromString("Local\\CozySSH_Mutex_" + strings.ReplaceAll(cfg.ConfigDir, "\\", "_"))
	if err != nil {
		fmt.Printf("Error creating mutex name: %v\n", err)
		os.Exit(1)
	}
	mutexHandle, err := windows.CreateMutex(nil, false, mutexName)
	if err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		fmt.Printf("Failed to create mutex: %v\n", err)
		os.Exit(1)
	}

	// 2. Check for an already running instance
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		if customActivateMsg != 0 {
			// Broadcast activation message to all top-level windows; the running instance will intercept it
			procPostMessage.Call(uintptr(0xFFFF), uintptr(customActivateMsg), 0, 0)
		}
		os.Exit(0)
	}
	defer windows.CloseHandle(mutexHandle)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serverErr := make(chan error, 1)
	readyChan := make(chan string, 1)

	// 3. Launch pure background manager safely on the unique leader instance
	go func() {
		serverErr <- cozyssh.RunWithFlags(ctx, flags, readyChan)
	}()

	// Wait explicitly until the internal backend server engine is ready
	select {
	case err := <-serverErr:
		messageBox("CozySSH startup error", fmt.Sprintf("Server exited early: %v", err))
		os.Exit(1)
	case <-readyChan:
		// Backend engine server port ready
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
		Debug:     true,
		AutoFocus: true,
		DataPath:  filepath.Join(cfg.ConfigDir, constants.WEBVIEW2_DATA_DIR),
		WindowOptions: webview2.WindowOptions{
			Title:     constants.APP_NAME,
			Width:     initWidth,
			Height:    initHeight,
			IconId:    2,
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

	// 4. Directly hook system tray interface and window interceptions on the main loop thread
	setupSystemTrayAndHook(w, hwnd, cfg)

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
					IconId:    2,
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

// setupSystemTrayAndHook builds the tray interface and window procedures on the active thread.
func setupSystemTrayAndHook(w webview2.WebView, hwnd uintptr, cfg *config.Config) {
	trayInstance = systray.New()

	iconBytes, _ := cozyssh.FrontendFS.ReadFile("frontend/dist/favicon.png")
	trayInstance.SetIcon(iconBytes).SetTooltip(constants.APP_NAME + " Background Service").Show()

	menu := systray.NewMenu()
	onClick := func() {
		w.Dispatch(func() {
			activateWindow(hwnd)
		})
	}
	menu.Add("Open "+constants.APP_NAME, onClick)
	menu.Add("Open Data Dir", func() {
		exec.Command("explorer", cfg.ConfigDir).Run()
	})
	menu.Add("Open SSH Dir", func() {
		exec.Command("explorer", cfg.SSHDir).Run()
	})
	menu.Add("Check update", func() {
		go checkAppUpdate(hwnd)
	})
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
	boxType := windows.MB_OK | windows.MB_ICONINFORMATION
	windows.MessageBox(windows.HWND(0), textPtr, titlePtr, uint32(boxType))
}

func windowProc(hwnd uintptr, msg uint32, wparam uintptr, lparam uintptr) uintptr {
	if msg == wmClose {
		procShowWindow.Call(hwnd, uintptr(swHide))
		return 0
	}
	// Intercept the dynamic custom window activation message from a secondary instance
	if customActivateMsg != 0 && msg == customActivateMsg {
		activateWindow(hwnd)
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

func activateWindow(hwnd uintptr) {
	// Check if the window is currently minimized to the taskbar
	minimized, _, _ := procIsIconic.Call(hwnd)
	if minimized != 0 {
		// If it was minimized, check if it was maximized prior to minimization
		maximized, _, _ := procIsZoomed.Call(hwnd)
		if maximized != 0 {
			procShowWindow.Call(hwnd, uintptr(swShowMaximized))
		} else {
			procShowWindow.Call(hwnd, uintptr(swShowNormal))
		}
	} else {
		// If it was hidden via close-to-tray, swShow (SW_SHOW) unhides it
		// while perfectly preserving its maximized or normal state.
		procShowWindow.Call(hwnd, uintptr(swShow))
	}
	procSetForegroundWindow.Call(hwnd)
}

//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"

	"cozyssh"
	"cozyssh/config"
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
)

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
	data, err := os.ReadFile(filepath.Join(cfgDir, "app-config.json"))
	if err != nil {
		return nil
	}
	var ac AppConfig
	if err := json.Unmarshal(data, &ac); err != nil {
		return nil
	}
	// Discard configurations with unreasonably small dimensions (e.g. from previous bugs)
	if ac.Width < 400 || ac.Height < 300 {
		return nil
	}
	return &ac
}

func saveAppConfig(cfgDir string, ac AppConfig) {
	data, _ := json.MarshalIndent(ac, "", "  ")
	_ = os.WriteFile(filepath.Join(cfgDir, "app-config.json"), data, 0600)
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

	// cfg.Addr may be "0.0.0.0:<port>": valid for binding, but browsers can't
	// reach that address. Normalise to 127.0.0.1.
	host, port, err := net.SplitHostPort(cfg.Addr)
	if err != nil {
		host, port = "127.0.0.1", "8022"
	}
	if host == "0.0.0.0" || host == "::" || host == "" {
		host = "127.0.0.1"
	}
	serverURL := "http://" + net.JoinHostPort(host, port)

	// Start the HTTP server in the background.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	serverErr := make(chan error, 1)
	go func() { serverErr <- cozyssh.Run(ctx, os.Args[1:]) }()

	if err := waitForServer(serverURL+"/api/preflight", 10*time.Second, serverErr); err != nil {
		showFatalDialog("CozySSH startup error", fmt.Sprintf("Server did not start in time: %v", err))
		os.Exit(1)
	}

	// Resolve window dimensions from saved config, or use defaults.
	appCfg := loadAppConfig(cfg.ConfigDir)
	firstRun := appCfg == nil

	defaultWidth := int(1280)
	defaultHeight := int(800)
	if !firstRun {
		defaultWidth = appCfg.Width
		defaultHeight = appCfg.Height
	}

	initWidth := uint(defaultWidth)
	initHeight := uint(defaultHeight)
	startMaximized := true // always maximized on first run
	if !firstRun {
		startMaximized = appCfg.Maximized
	}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     true, // allow F12 DevTools
		AutoFocus: true,
		// the default data path is volatile that some data like page zoom level doesn't persist across restarts.
		DataPath: filepath.Join(cfg.ConfigDir, "webview2_data"),
		WindowOptions: webview2.WindowOptions{
			Title:     "CozySSH",
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

	w.Navigate(serverURL + "/")

	// Poll window state every second and persist changes.
	// We track the last *non-maximized* dimensions separately so that when
	// the user maximizes the window, we don't overwrite the restore size.
	lastNonMaxW, lastNonMaxH := defaultWidth, defaultHeight

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
				saveAppConfig(cfg.ConfigDir, AppConfig{
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

	cancel()
	select {
	case err := <-serverErr:
		if err != nil && err != context.Canceled {
			_ = err
		}
	case <-time.After(3 * time.Second):
	}
}

// waitForServer polls url until it gets a response or the deadline is reached.
// It also returns immediately if the server goroutine exits with an error.
func waitForServer(url string, timeout time.Duration, serverErr <-chan error) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		select {
		case err := <-serverErr:
			return fmt.Errorf("server exited early: %w", err)
		default:
		}
		if resp, err := client.Get(url); err == nil {
			resp.Body.Close()
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("timed out after %s", timeout)
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

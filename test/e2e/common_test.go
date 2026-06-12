//go:build integration

package e2e

// go test -tags=integration ./test/e2e/...

import (
	"context"
	"cozyssh"
	"cozyssh/common"
	"cozyssh/constants"
	"cozyssh/models"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-http-utils/headers"
	"github.com/ory/dockertest/v4"
	"github.com/playwright-community/playwright-go"
)

// yescrypt hash of `123456`
const PASSWORD_HASH_123456 = "$y$j9T$jKQVBWNujTG0c1nVGLoO0.$V4sEZinfjMEcEUesyGvzDsTGcchoP1sV2A7BedR5Qn5"

var (
	pwInstance *playwright.Playwright
	browser    playwright.Browser
	pool       dockertest.ClosablePool
)

func TestMain(m *testing.M) {
	var err error

	ctx := context.Background()
	pool, err = dockertest.NewPool(ctx, "")
	if err != nil {
		log.Fatalf("Could not connect to docker: %s", err)
	}

	err = playwright.Install()
	if err != nil {
		log.Fatalf("Could not install playwright: %s", err)
	}

	pwInstance, err = playwright.Run()
	if err != nil {
		log.Fatalf("Could not start playwright: %s", err)
	}

	browser, err = pwInstance.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		log.Fatalf("Could not launch browser: %s", err)
	}

	code := m.Run()

	browser.Close()
	pwInstance.Stop()

	// Clean up the pool when tests are done
	pool.Close(ctx)

	os.Exit(code)
}

func startTestApp(t *testing.T, args []string) string {
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	// Find a free port
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	l.Close()

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	args = append(args, "-addr", addr)

	go func() {
		if err := cozyssh.Run(ctx, args); err != nil && err != context.Canceled {
			fmt.Printf("App failed: %v\n", err)
		}
	}()

	// Wait for app to be ready
	url := fmt.Sprintf("http://%s", addr)
	for range 50 {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return url
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatal("App failed to start in time")
	return ""
}

func createPage(t *testing.T) playwright.Page {
	context, err := browser.NewContext()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { context.Close() })

	page, err := context.NewPage()
	if err != nil {
		t.Fatal(err)
	}

	page.On("console", func(msg playwright.ConsoleMessage) {
		t.Logf("BROWSER CONSOLE: %s", msg.Text())
	})

	return page
}

func login(t *testing.T, page playwright.Page, url string, password string) {
	if _, err := page.Goto(url); err != nil {
		t.Fatal(err)
	}

	if err := page.Fill("input[type=\"password\"]", password); err != nil {
		t.Fatal(err)
	}

	if err := page.Click("button[type=\"submit\"]"); err != nil {
		t.Fatal(err)
	}

	// Wait for dashboard
	selector := "input[placeholder*=\"Filter hosts\"]"
	if _, err := page.WaitForSelector(selector); err != nil {
		t.Fatalf("Login failed or dashboard not loaded: %v", err)
	}
}

func setupTestConfig(t *testing.T) string {
	tmpDir, err := os.MkdirTemp("", "cozyssh-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(tmpDir) })

	// yescrypt hashed password of "123456"
	configContent := `{
  "addr": "127.0.0.1:0",
  "app_password_hash": "` + PASSWORD_HASH_123456 + `",
  "sshdir": "` + filepath.ToSlash(filepath.Join(tmpDir, ".ssh")) + `",
  "insecure_ignore_host_key": true
}`
	err = common.AtomicWriteFileContents(filepath.Join(tmpDir, "config.json"), []byte(configContent))
	if err != nil {
		t.Fatal(err)
	}

	err = os.MkdirAll(filepath.Join(tmpDir, ".ssh"), 0700)
	if err != nil {
		t.Fatal(err)
	}

	return tmpDir
}

func StartSSHContainer(t *testing.T, user, password string) (string, string) {
	ctx := context.Background()

	resource, err := pool.Run(ctx, "rastasheep/ubuntu-sshd",
		dockertest.WithTag("latest"),
	)
	if err != nil {
		t.Fatalf("Could not start resource: %s", err)
	}

	t.Cleanup(func() {
		if err := resource.Close(ctx); err != nil {
			t.Logf("Could not close resource: %s", err)
		}
	})

	addr := resource.GetHostPort("22/tcp")
	if addr == "" {
		t.Fatal("SSH container address is empty")
	}
	_, port, _ := net.SplitHostPort(addr)
	addr = net.JoinHostPort("127.0.0.1", port)

	// Wait for SSH to be ready
	for range 100 {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			host, port, _ := net.SplitHostPort(addr)
			return host, port
		}
		time.Sleep(100 * time.Millisecond)
	}
	return "", ""
}

func waitForTerminalText(t *testing.T, page playwright.Page, text string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		content, err := page.Evaluate("() => csGetTerminalContents(50)")
		if err != nil {
			t.Fatalf("failed to get terminal contents: %v", err)
		}
		if strings.Contains(content.(string), text) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for terminal text: %s", text)
}

// waitForTerminalTextInPane polls a specific pane (by its frontend pane ID) for
// the given text, bypassing the active-pane lookup. Use this when multiple tabs
// are open and the desired terminal is not necessarily the active one.
// The terminal content is stripped of newlines before matching because the
// headless xterm may wrap long lines in a very narrow viewport.
func waitForTerminalTextInPane(t *testing.T, page playwright.Page, paneId, text string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var lastContent string
	for time.Now().Before(deadline) {
		content, err := page.Evaluate(fmt.Sprintf("() => csGetTerminalContents(50, %q)", paneId))
		if err != nil {
			t.Fatalf("failed to get terminal contents for pane %s: %v", paneId, err)
		}
		if content != nil {
			lastContent = content.(string)
			// Strip whitespace/newlines so that wrapping doesn't prevent matching.
			normalized := strings.ReplaceAll(lastContent, "\n", "")
			normalized = strings.ReplaceAll(normalized, " ", "")
			textNorm := strings.ReplaceAll(text, " ", "")
			if strings.Contains(normalized, textNorm) {
				return
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for terminal text %q in pane %s\nlast content: %q", text, paneId, lastContent)
}

// apiPost is a helper to POST JSON to a protected API endpoint.
func apiPost(t *testing.T, baseURL, token, path string, body any) *http.Response {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("apiPost marshal: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, baseURL+path, strings.NewReader(string(b)))
	if err != nil {
		t.Fatalf("apiPost request: %v", err)
	}
	req.Header.Set(headers.Authorization, constants.HEADER_AUTHORIZATION_BEARER_PREFIX+token)
	req.Header.Set(headers.ContentType, constants.MIME_JSON)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("apiPost do: %v", err)
	}
	return resp
}

// apiGet GETs a protected API endpoint and returns the decoded JSON.
func apiGet(t *testing.T, baseURL, token, path string) any {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, baseURL+path, nil)
	if err != nil {
		t.Fatalf("apiGet request: %v", err)
	}
	req.Header.Set(headers.Authorization, constants.HEADER_AUTHORIZATION_BEARER_PREFIX+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("apiGet do: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("apiGet unmarshal: %v (body: %s)", err, raw)
	}
	return v
}

// getToken extracts the cozy_token from a logged-in page's localStorage.
func getToken(t *testing.T, page playwright.Page) string {
	t.Helper()
	tok, err := page.Evaluate(`() => localStorage.getItem('` + constants.BROWSER_STORAGE_KEY_TOKEN + `')`)
	if err != nil || tok == nil {
		t.Fatal("could not get cozy_token from localStorage")
	}
	return tok.(string)
}

// pinnedSessions fetches /api/sessions/pinned and returns the parsed slice.
func pinnedSessions(t *testing.T, baseURL, token string) []*models.SessionPinned {
	t.Helper()
	v := apiGet(t, baseURL, token, "/api/sessions/pinned")
	if v == nil {
		return nil
	}
	raw, _ := json.Marshal(v)
	var result []*models.SessionPinned
	json.Unmarshal(raw, &result)
	return result
}

// Return selector of xterm screen with specified paneId. If paneId is empty, return selector of any xterm screen
func selectorXterm(paneId string) string {
	if paneId == "" {
		return `.terminal-pane-wrap .xterm-screen`
	} else {
		return fmt.Sprintf(`.terminal-pane-wrap[data-id="%s"] .xterm-screen`, paneId)
	}
}

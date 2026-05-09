//go:build integration

package e2e

import (
	"fmt"
	"testing"
	"time"

	"github.com/playwright-community/playwright-go"
)

func TestLocalShell(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})
	page := createPage(t)
	login(t, page, url, "123456")

	// 1. Open local shell using scripting API
	_, err := page.Evaluate("() => csOpen('local', { name: 'LOCAL_TEST' })")
	if err != nil {
		t.Fatal(err)
	}

	// 2. Wait for terminal to be active and ready
	_, err = page.WaitForSelector("div[data-pane-id] .xterm-screen")
	if err != nil {
		t.Fatal(err)
	}

	// 3. Send command using scripting API
	// Use a small delay to ensure xterm.js is fully initialized and attached
	time.Sleep(2 * time.Second)
	_, err = page.Evaluate("() => csSendData('echo \"hello cozy e2e\"\\n')")
	if err != nil {
		t.Fatal(err)
	}

	// 4. Verify output using scripting API
	waitForTerminalText(t, page, "hello cozy e2e", 10*time.Second)
}

func TestSSHShell(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})
	page := createPage(t)
	login(t, page, url, "123456")

	// 1. Start SSH container
	user := "root"
	pass := "root"
	host, port := StartSSHContainer(t, user, pass)
	time.Sleep(5 * time.Second)

	// 2. Open SSH session using scripting API
	// Format: user:pass@host:port
	connStr := fmt.Sprintf("%s:%s@%s:%s", user, pass, host, port)
	fmt.Printf("Calling csOpen for %s\n", connStr)
	_, err := page.Evaluate(fmt.Sprintf("() => csOpen('%s', { name: 'SSH_TEST' })", connStr))
	if err != nil {
		t.Fatal(err)
	}

	// 3. Wait for any xterm-screen to be attached to the DOM.
	// NOTE: We use state:"attached" (not the default "visible") because two tabs exist
	// in the DOM at this point. The initial "local" tab is hidden via display:none on
	// its parent, so its .xterm-screen is never "visible" even though it's in the DOM.
	// WaitForSelector with state:"visible" would latch onto the hidden local tab's
	// xterm-screen and wait forever. Using "attached" lets us proceed as soon as any
	// xterm-screen is present, and we rely on waitForTerminalText for real readiness.
	_, err = page.WaitForSelector("div[data-pane-id] .xterm-screen", playwright.PageWaitForSelectorOptions{
		Timeout: playwright.Float(30000),
		State:   playwright.WaitForSelectorStateAttached,
	})
	if err != nil {
		path := "test_failure.png"
		page.Screenshot(playwright.PageScreenshotOptions{Path: playwright.String(path)})
		t.Fatalf("Timeout waiting for terminal: %v. Screenshot saved to %s", err, path)
	}

	// 4. Send command and verify output.
	// waitForTerminalText polls until the SSH shell prompt appears, so no fixed sleep needed.
	_, err = page.Evaluate("() => csSendData('whoami\\n')")
	if err != nil {
		t.Fatal(err)
	}

	// 5. Verify output
	waitForTerminalText(t, page, user, 30*time.Second)
}

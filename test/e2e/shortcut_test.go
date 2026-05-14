//go:build integration

package e2e

import (
	"fmt"
	"testing"
	"time"

	"github.com/playwright-community/playwright-go"
)

func TestKeyboardShortcuts(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	ctx, _ := browser.NewContext()
	page, _ := ctx.NewPage()

	login(t, page, url, "123456")
	token := getToken(t, page)

	// Clean up leaked pinned sessions from previous tests
	for _, p := range pinnedSessions(t, url, token) {
		apiPost(t, url, token, "/api/tabs/unpin", map[string]string{"id": p["id"].(string)})
	}

	// Wait for default local shell
	if _, err := page.WaitForSelector("div[data-pane-id] .xterm-screen", playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	}); err != nil {
		t.Fatalf("terminal not attached: %v", err)
	}

	// 1. Alt + T : Open new tab dialog
	page.Locator("div[data-pane-id] .xterm-screen").First().Click()
	if err := page.Keyboard().Press("Alt+t"); err != nil {
		t.Fatalf("failed to press Alt+T: %v", err)
	}

	// Wait for dialog
	if _, err := page.WaitForSelector("input[placeholder*='Search for a server']", playwright.PageWaitForSelectorOptions{}); err != nil {
		t.Fatalf("dialog not opened: %v", err)
	}

	// Click 'Local Shell' to open a second tab
	if err := page.Locator("div[role='dialog']").GetByRole("button", playwright.LocatorGetByRoleOptions{
		Name:  "Local Shell",
		Exact: playwright.Bool(false),
	}).First().Click(); err != nil {
		t.Fatalf("failed to open local shell: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// We should have 2 panes now
	paneCount, _ := page.Evaluate(`() => csGetAll().tabs.reduce((acc, t) => acc + t.panes.length, 0)`)
	if paneCount == nil || paneCount.(int) != 2 {
		t.Fatalf("expected 2 panes, got %v", paneCount)
	}

	// Active tab is the second one
	firstPaneId, _ := page.Evaluate(`() => csGetAll().tabs[0].panes[0].id`)
	secondPaneId, _ := page.Evaluate(`() => csGetAll().tabs[1].panes[0].id`)

	activePaneId, _ := page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != secondPaneId {
		t.Fatalf("expected active pane to be second one (%v), got %v", secondPaneId, activePaneId)
	}

	// 2. Alt + H : Switch to previous tab
	if err := page.Keyboard().Press("Alt+h"); err != nil {
		t.Fatalf("failed to press Alt+h: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != firstPaneId {
		t.Fatalf("expected active pane to be first one (%v) after Alt+h, got %v", firstPaneId, activePaneId)
	}

	// 3. Alt + L : Switch to next tab
	if err := page.Keyboard().Press("Alt+l"); err != nil {
		t.Fatalf("failed to press Alt+l: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != secondPaneId {
		t.Fatalf("expected active pane to be second one (%v) after Alt+j, got %v", secondPaneId, activePaneId)
	}

	// Click sidebar to remove focus from terminal
	page.Locator("text=CozySSH").Click()
	time.Sleep(100 * time.Millisecond)

	// Alt + h when focus is outside terminal
	if err := page.Keyboard().Press("Alt+h"); err != nil {
		t.Fatalf("failed to press Alt+h outside: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != firstPaneId {
		t.Fatalf("expected active pane to be first one (%v) after Alt+h outside, got %v", firstPaneId, activePaneId)
	}

	// Verify terminal actually has focus
	hasFocus, _ := page.Evaluate(fmt.Sprintf(`() => {
		const term = csGetAll().terminals[%q];
		return term && document.activeElement.tagName === 'TEXTAREA';
	}`, firstPaneId))
	if hasFocus == nil || !hasFocus.(bool) {
		t.Fatalf("expected terminal to have focus after Alt+k outside")
	}

	// 4. Alt + 2 : Switch to tab 2
	if err := page.Keyboard().Press("Alt+2"); err != nil {
		t.Fatalf("failed to press Alt+2: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != secondPaneId {
		t.Fatalf("expected active pane to be second one (%v) after Alt+2, got %v", secondPaneId, activePaneId)
	}

	// 5. Alt + 0 : Switch to last tab (which is 2)
	if err := page.Keyboard().Press("Alt+1"); err != nil {
		t.Fatalf("err")
	}
	time.Sleep(100 * time.Millisecond)
	if err := page.Keyboard().Press("Alt+0"); err != nil {
		t.Fatalf("err")
	}
	time.Sleep(100 * time.Millisecond)
	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != secondPaneId {
		t.Fatalf("expected active pane to be second one (%v) after Alt+0, got %v", secondPaneId, activePaneId)
	}

	// 6. Alt + W : Close current tab
	if err := page.Keyboard().Press("Alt+w"); err != nil {
		t.Fatalf("failed to press Alt+w: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	paneCount, _ = page.Evaluate(`() => csGetAll().tabs.reduce((acc, t) => acc + t.panes.length, 0)`)
	if paneCount == nil || paneCount.(int) != 1 {
		t.Fatalf("expected 1 pane after Alt+w, got %v", paneCount)
	}

	activePaneId, _ = page.Evaluate(`() => csGetAll().activePaneId`)
	if activePaneId != firstPaneId {
		t.Fatalf("expected active pane to be first one (%v) after Alt+w, got %v", firstPaneId, activePaneId)
	}

	ctx.Close()
}

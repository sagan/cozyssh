//go:build integration

package e2e

import (
	"cozyssh/common"
	"cozyssh/constants"
	"cozyssh/models"
	"fmt"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	"github.com/playwright-community/playwright-go"
)

// getToken extracts the cozy_token from a logged-in page's localStorage.

// openTabAndWaitForShell opens a local shell tab via csOpen and waits for a
// shell prompt to appear, confirming the terminal is fully connected.
func openTabAndWaitForShell(t *testing.T, page playwright.Page, name string) {
	t.Helper()
	_, err := page.Evaluate(fmt.Sprintf("() => csOpen('local', { title: %q })", name))
	if err != nil {
		t.Fatalf("csOpen: %v", err)
	}
	// Wait until the terminal container is in the DOM.
	_, err = page.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	})
	if err != nil {
		t.Fatalf("xterm-screen not attached: %v", err)
	}
	// Let the shell connect and display its prompt.
	time.Sleep(2 * time.Second)
}

// getActivePaneId returns the current activePaneId from the scripting API.
func getActivePaneId(t *testing.T, page playwright.Page) string {
	t.Helper()
	v, err := page.Evaluate("() => csGetAll().activePaneId")
	if err != nil || v == nil {
		t.Fatal("could not get activePaneId")
	}
	return v.(string)
}

// getActiveSessionId returns the backend session ID for the currently active pane.
// The frontend stores it as pane.sessionId (for attached sessions) or pane.id
// (for new sessions). We read it via csGetAll().
func getActiveSessionId(t *testing.T, page playwright.Page) string {
	t.Helper()
	raw, err := page.Evaluate(`() => {
		const all = csGetAll();
		const pid = all.activePaneId;
		for (const tab of all.tabs) {
			const pane = tab.panes.find(p => p.id === pid);
			if (pane) {
				return pane.sessionId || pane.id;
			}
		}
		return null;
	}`)
	if err != nil || raw == nil {
		t.Fatal("could not get active session id")
	}
	return raw.(string)
}

// TestPinTab verifies the full pin lifecycle:
//  1. Open a local shell tab.
//  2. Pin it via the API.
//  3. Refresh the page — the pinned session auto-reattaches.
//  4. Unpin it via the API.
//  5. Refresh again — the session is gone from the page and from the pinned list.
func TestPinTab(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})
	page := createPage(t)
	login(t, page, url, "123456")

	// 1. Open a local shell.
	openTabAndWaitForShell(t, page, "PIN_TEST")
	token := getToken(t, page)
	sessionId := getActiveSessionId(t, page)
	t.Logf("session id: %s", sessionId)

	// 2. Pin it via the API (simulates right-click → "Pin tab").
	resp := apiPost(t, url, token, "/api/tabs/pin", &models.TabsPinRequest{
		Id:    sessionId,
		Host:  constants.LOCAL_NAME,
		Title: "PIN_TEST",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("pin: expected 204, got %d", resp.StatusCode)
	}

	// Verify backend reports the session as pinned.
	pinned := pinnedSessions(t, url, token)
	if len(pinned) == 0 {
		t.Fatal("expected at least one pinned session, got none")
	}
	found := false
	for _, p := range pinned {
		if p.Id == sessionId {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("pinned sessions don't include %s: %v", sessionId, pinned)
	}

	// 3. Reload the page — the pinned session should reappear automatically.
	if _, err := page.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	// Wait for dashboard to load.
	if _, err := page.WaitForSelector("input[placeholder*=\"Filter hosts\"]"); err != nil {
		t.Fatalf("dashboard after reload: %v", err)
	}
	// Wait for the pinned tab's terminal to attach.
	_, err := page.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	})
	if err != nil {
		t.Fatalf("pinned tab terminal not attached after reload: %v", err)
	}

	// Verify the tab title shown in the UI matches the pinned title.
	tabTitle, err := page.Evaluate(`() => csGetAll().tabs.find(t => t.isPinned)?.title`)
	if err != nil || tabTitle == nil || tabTitle.(string) == "" {
		t.Fatalf("no pinned tab found in UI after reload (tabTitle=%v, err=%v)", tabTitle, err)
	}
	t.Logf("pinned tab title after reload: %s", tabTitle)

	// 4. Unpin via the API.
	resp = apiPost(t, url, token, "/api/tabs/unpin", &models.TabsUnpinRequest{Id: sessionId})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("unpin: expected 204, got %d", resp.StatusCode)
	}

	// 5. Reload again — no pinned tabs should auto-open.
	if _, err := page.Reload(); err != nil {
		t.Fatalf("reload 2: %v", err)
	}
	if _, err := page.WaitForSelector("input[placeholder*=\"Filter hosts\"]"); err != nil {
		t.Fatalf("dashboard after reload 2: %v", err)
	}
	// Give the 350ms init timer time to fire.
	time.Sleep(600 * time.Millisecond)

	pinnedAfter, err := page.Evaluate("() => csGetAll().tabs.filter(t => t.isPinned).length")
	if err != nil {
		t.Fatalf("eval: %v", err)
	}
	if count, ok := pinnedAfter.(float64); ok && count != 0 {
		t.Errorf("expected 0 pinned tabs after unpin+reload, got %v", count)
	}
}

// TestLockTab verifies that a locked tab:
//   - Cannot be closed via /api/sessions/close (session stays alive).
//   - Is reported as both pinned and locked by /api/sessions/pinned.
//   - Can be downgraded to pinned (not locked) via /api/tabs/pin, after which it
//     can be closed.
func TestLockTab(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})
	page := createPage(t)
	login(t, page, url, "123456")

	openTabAndWaitForShell(t, page, "LOCK_TEST")
	token := getToken(t, page)
	sessionId := getActiveSessionId(t, page)
	t.Logf("session id: %s", sessionId)

	// Lock the session.
	resp := apiPost(t, url, token, "/api/tabs/lock", &models.TabsLockRequest{
		Id:    sessionId,
		Host:  constants.LOCAL_NAME,
		Title: "LOCK_TEST",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("lock: expected 204, got %d", resp.StatusCode)
	}

	// Verify backend sees it as locked.
	pinned := pinnedSessions(t, url, token)
	var lockedEntry *models.SessionPinned
	for _, p := range pinned {
		if p.Id == sessionId {
			lockedEntry = p
			break
		}
	}
	if lockedEntry == nil {
		t.Fatalf("locked session %s not in pinned list: %v", sessionId, pinned)
	}
	if lockedEntry.IsLocked != true {
		t.Errorf("expected isLocked=true, got %v", lockedEntry.IsLocked)
	}

	// Try to close the session — must be a no-op because it's locked.
	resp = apiPost(t, url, token, "/api/sessions/close", &models.SessionsCloseRequest{Id: sessionId})
	resp.Body.Close()

	// Reload the page — the locked session must auto-reopen.
	if _, err := page.Reload(); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if _, err := page.WaitForSelector("input[placeholder*=\"Filter hosts\"]"); err != nil {
		t.Fatalf("dashboard after reload: %v", err)
	}
	_, err := page.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	})
	if err != nil {
		t.Fatalf("locked tab not reattached after reload: %v", err)
	}

	// Downgrade: unlock → pin only (so it can be closed).
	resp = apiPost(t, url, token, "/api/tabs/pin", &models.TabsPinRequest{
		Id:    sessionId,
		Host:  constants.LOCAL_NAME,
		Title: "LOCK_TEST",
	})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("downgrade to pin: expected 204, got %d", resp.StatusCode)
	}

	// Now close should succeed.
	resp = apiPost(t, url, token, "/api/sessions/close", &models.SessionsCloseRequest{Id: sessionId})
	resp.Body.Close()

	// Verify it's gone from the pinned list.
	pinnedAfter := pinnedSessions(t, url, token)
	for _, p := range pinnedAfter {
		if p.Id == sessionId {
			t.Errorf("session %s still in pinned list after close: %v", sessionId, pinnedAfter)
		}
	}
}

// TestAttachStealsSession verifies that opening a second browser tab and
// "attaching" to an existing pinned session causes the first tab's terminal
// to display the "*** Session stolen ***" message, while the second tab
// becomes the new active listener.
func TestAttachStealsSession(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	// --- Client A: opens a local shell and pins it ---
	pageA := createPage(t)
	login(t, pageA, url, "123456")
	openTabAndWaitForShell(t, pageA, "STEAL_TEST")
	tokenA := getToken(t, pageA)
	sessionId := getActiveSessionId(t, pageA)
	t.Logf("session id: %s", sessionId)

	// Send a marker command so we can verify history later.
	_, err := pageA.Evaluate("() => csSendData('echo stolen_marker\\n')")
	if err != nil {
		t.Fatalf("csSendData: %v", err)
	}
	waitForTerminalText(t, pageA, "stolen_marker", 10*time.Second)

	// Pin the session so it persists when the WS is stolen.
	resp := apiPost(t, url, tokenA, "/api/tabs/pin", &models.TabsPinRequest{
		Id:    sessionId,
		Host:  constants.LOCAL_NAME,
		Title: "STEAL_TEST",
	})
	resp.Body.Close()

	// --- Client B: attaches (steals) the same session ---
	pageB := createPage(t)
	login(t, pageB, url, "123456")

	// Use the attach scripting API (same as clicking the "Attach" entry in the Dashboard).
	// csAttach calls attachSession: it posts to /api/sessions/attach then opens a UI tab
	// with pane.sessionId = id so the WS reconnects to the existing backend session.
	_, err = pageB.Evaluate(fmt.Sprintf(`() => csAttach(%q, 'local', 'STOLEN_VIEW', false)`, sessionId))
	if err != nil {
		t.Fatalf("csAttach: %v", err)
	}

	// Client B should receive the session history, including our marker.
	waitForTerminalText(t, pageB, "stolen_marker", 15*time.Second)
	t.Log("Client B received history successfully")

	// Client A should see the "stolen" message in its terminal.
	waitForTerminalText(t, pageA, "stolen", 10*time.Second)
	t.Log("Client A terminal shows 'stolen' message — correct")

	// The backend session should still be alive (pinned).
	pinned := pinnedSessions(t, url, tokenA)
	found := false
	for _, p := range pinned {
		if p.Id == sessionId {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("pinned session %s disappeared after steal: %v", sessionId, pinned)
	}
}

// TestPinnedSessionSurvivesClientDisconnect verifies that a pinned session
// remains registered in the backend even after the WebSocket client disconnects
// (i.e., the browser tab closes / the context is cleaned up).  The session
// should still appear in /api/sessions/pinned with listenerCount == 0 and
// be re-attachable by a new client.
func TestPinnedSessionSurvivesClientDisconnect(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	// Open browser context A, create a shell, pin it.
	ctxA, err := browser.NewContext()
	if err != nil {
		t.Fatal(err)
	}
	pageA, err := ctxA.NewPage()
	if err != nil {
		t.Fatal(err)
	}
	pageA.On("console", func(msg playwright.ConsoleMessage) {
		t.Logf("A CONSOLE: %s", msg.Text())
	})

	login(t, pageA, url, "123456")
	openTabAndWaitForShell(t, pageA, "SURVIVE_TEST")
	token := getToken(t, pageA)
	sessionId := getActiveSessionId(t, pageA)
	t.Logf("session id: %s", sessionId)

	// Write a unique marker into the shell history.
	_, err = pageA.Evaluate("() => csSendData('echo survive_marker\\n')")
	if err != nil {
		t.Fatalf("csSendData: %v", err)
	}
	waitForTerminalText(t, pageA, "survive_marker", 10*time.Second)

	// Pin.
	resp := apiPost(t, url, token, "/api/tabs/pin", &models.TabsPinRequest{
		Id:    sessionId,
		Host:  constants.LOCAL_NAME,
		Title: "SURVIVE_TEST",
	})
	resp.Body.Close()

	// Close browser context A (simulates the browser tab closing).
	ctxA.Close()

	// Give the server a moment to process the WS disconnect.
	time.Sleep(500 * time.Millisecond)

	// The session must still be listed as pinned with listenerCount == 0.
	pinned := pinnedSessions(t, url, token)
	var entry *models.SessionPinned
	for _, p := range pinned {
		if p.Id == sessionId {
			entry = p
			break
		}
	}
	if entry == nil {
		t.Fatalf("session %s not in pinned list after client disconnect: %v", sessionId, pinned)
	}
	if entry.ListenerCount != 0 {
		t.Errorf("expected listenerCount=0, got %v", entry.ListenerCount)
	}

	// Client B loads — the pinned session should auto-open.
	pageB := createPage(t)
	login(t, pageB, url, "123456")

	// Wait for the pinned terminal to attach (may open alongside a fresh local tab).
	_, err = pageB.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	})
	if err != nil {
		t.Fatalf("pinned tab not auto-opened for client B: %v", err)
	}

	// Find the pane ID for the pinned session in client B's tab list, then
	// read from that specific pane rather than the active one (which might be
	// a concurrently opened local tab).
	pinnedPaneId, err := pageB.Evaluate(fmt.Sprintf(`() => {
		const all = csGetAll();
		for (const tab of all.tabs) {
			for (const pane of tab.panes) {
				if ((pane.sessionId || pane.id) === %q) {
					return pane.id;
				}
			}
		}
		return null;
	}`, sessionId))
	if err != nil || pinnedPaneId == nil {
		t.Fatalf("pinned pane not found in client B tabs (sessionId=%s): %v", sessionId, err)
	}
	t.Logf("pinned pane id on client B: %v", pinnedPaneId)

	// Give the terminal extra time to receive and render historical output from the
	// server's circular buffer (sent on WS connect as historyStart/binary frames).
	time.Sleep(3 * time.Second)

	// Read history from the specific pinned pane rather than the active pane
	// (initAsync also opens a fresh local tab, so the active pane might be wrong).
	waitForTerminalTextInPane(t, pageB, pinnedPaneId.(string), "survive_marker", 15*time.Second)
	t.Log("Client B received historical output from survived pinned session")
}

func TestDirectUrlOpenSingle(t *testing.T) {
	configDir := setupTestConfig(t)
	// Add test hosts to ssh config
	sshConfig := `
Host home
    HostName 127.0.0.1
    User test

### #fav
Host fav1
    HostName 127.0.0.1
    User test

### #fav
Host fav2
    HostName 127.0.0.1
    User test
`
	err := common.AtomicWriteFileContents(filepath.Join(configDir, ".ssh", "config"), []byte(sshConfig))
	if err != nil {
		t.Fatal(err)
	}

	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	ctx, _ := browser.NewContext()
	page, _ := ctx.NewPage()
	login(t, page, url, "123456")

	// Clean up leaked pinned sessions from previous tests because session.GlobalManager is global
	token := getToken(t, page)
	for _, p := range pinnedSessions(t, url, token) {
		apiPost(t, url, token, "/api/tabs/unpin", &models.TabsUnpinRequest{Id: p.Id})
	}

	// Now open the target URL directly (since token is in localStorage for this origin, it will skip login)
	if _, err := page.Goto(url + "/#home"); err != nil {
		t.Fatal(err)
	}
	if _, err := page.Reload(); err != nil {
		t.Fatal(err)
	}
	// Wait for the terminal container to be attached
	if _, err := page.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	}); err != nil {
		t.Fatal(err)
	}

	// Verify the active tab is "home"
	tabTitle, err := page.Evaluate(`() => {
		const all = csGetAll();
		return all.tabs.find(t => t.id === all.activePaneId || t.activePaneId === all.activePaneId)?.title;
	}`)
	if err != nil || tabTitle == nil || tabTitle.(string) != "home" {
		t.Fatalf("expected tab 'home' to be opened, got %v (err=%v)", tabTitle, err)
	}

	// Check that there is only 1 pane in the tab
	paneCount, err := page.Evaluate(`() => {
		const all = csGetAll();
		const activeTab = all.tabs.find(t => t.id === all.activePaneId || t.activePaneId === all.activePaneId);
		return activeTab ? activeTab.panes.length : 0;
	}`)
	if err != nil || paneCount == nil || paneCount.(int) != 1 {
		t.Fatalf("expected 1 pane, got %v", paneCount)
	}

	ctx.Close()
}

func TestDirectUrlOpenTag(t *testing.T) {
	configDir := setupTestConfig(t)
	// Add test hosts to ssh config
	sshConfig := `
Host home
    HostName 127.0.0.1
    User test

### #fav
Host fav1
    HostName 127.0.0.1
    User test

### #fav
Host fav2
    HostName 127.0.0.1
    User test
`
	err := common.AtomicWriteFileContents(filepath.Join(configDir, ".ssh", "config"), []byte(sshConfig))
	if err != nil {
		t.Fatal(err)
	}

	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	ctx, _ := browser.NewContext()
	page, _ := ctx.NewPage()
	login(t, page, url, "123456")

	// Clean up leaked pinned sessions from previous tests
	token := getToken(t, page)
	for _, p := range pinnedSessions(t, url, token) {
		apiPost(t, url, token, "/api/tabs/unpin", &models.TabsUnpinRequest{Id: p.Id})
	}

	// Now open the tag URL directly
	if _, err := page.Goto(url + "/##fav"); err != nil {
		t.Fatal(err)
	}
	if _, err := page.Reload(); err != nil {
		t.Fatal(err)
	}
	// Wait for terminal
	if _, err := page.WaitForSelector(selectorXterm(""), playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(10000),
	}); err != nil {
		t.Fatal(err)
	}

	// Verify that the active tab has 2 panes
	paneCount, err := page.Evaluate(`() => {
		const all = csGetAll();
		const activeTab = all.tabs.find(t => t.panes.some(p => p.id === all.activePaneId));
		return activeTab ? activeTab.panes.length : 0;
	}`)
	if err != nil || paneCount == nil || paneCount.(int) != 2 {
		t.Fatalf("expected 2 panes for tag 'fav', got %v (err=%v)", paneCount, err)
	}

	ctx.Close()
}

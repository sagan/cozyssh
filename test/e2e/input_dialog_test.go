//go:build integration

package e2e

import (
	"testing"
	"time"

	"github.com/playwright-community/playwright-go"
)

// TestTerminalInputDialog verifies the full "INPUT (Prompt)" flow:
//
//  1. Open CozySSH, wait for the default local terminal tab to be ready.
//  2. Press Alt+E to open the New Tab Dialog in "buttons" view.
//  3. Type "input" in the filter field, then click the "INPUT (Prompt)"
//     built-in button to open the "Terminal Input" dialog.
//  4. Enter a complex string that contains <ctrl-x> escape sequences
//     and press Enter to send it to the terminal.
//  5. Verify that the sent commands were executed correctly by checking
//     for their output in the terminal (e.g., file creation via vi).
func TestTerminalInputDialog(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})
	page := createPage(t)
	login(t, page, url, "123456")

	// 1. Wait for the default local terminal tab to be ready.
	// The app opens a local shell tab on startup; wait for the xterm canvas.
	if _, err := page.WaitForSelector("div[data-pane-id] .xterm-screen", playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(15000),
	}); err != nil {
		t.Fatalf("default local terminal not attached: %v", err)
	}

	// 2. Press Alt+E to open the New Tab Dialog in "buttons" view.
	if err := page.Keyboard().Press("Alt+e"); err != nil {
		t.Fatalf("failed to press Alt+e: %v", err)
	}

	// Wait for the New Tab Dialog to appear and confirm it is in buttons view.
	if _, err := page.WaitForSelector("#new-tab-dialog[data-view='buttons']", playwright.PageWaitForSelectorOptions{
		Timeout: playwright.Float(5000),
	}); err != nil {
		t.Fatalf("New Tab Dialog (buttons view) did not open: %v", err)
	}

	// 3. Type "input" in the filter field to narrow the list to INPUT (Prompt).
	if err := page.Locator("#new-tab-dialog input[type='search']").Fill("input"); err != nil {
		t.Fatalf("failed to type in New Tab Dialog filter: %v", err)
	}
	time.Sleep(200 * time.Millisecond)

	// Find and click the "INPUT (Prompt)" built-in button item.
	inputBtn := page.Locator("#new-tab-dialog").GetByRole("button", playwright.LocatorGetByRoleOptions{
		Name:  "INPUT (Prompt)",
		Exact: playwright.Bool(false),
	}).First()
	if err := inputBtn.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(5000),
	}); err != nil {
		t.Fatalf("INPUT (Prompt) button not visible in list: %v", err)
	}
	if err := inputBtn.Click(); err != nil {
		t.Fatalf("failed to click INPUT (Prompt) button: %v", err)
	}

	// 4. The "Terminal Input" dialog should now be open.
	if _, err := page.WaitForSelector("text=Terminal Input", playwright.PageWaitForSelectorOptions{
		Timeout: playwright.Float(5000),
	}); err != nil {
		t.Fatalf("Terminal Input dialog did not open: %v", err)
	}

	// Type a complex command string with <ctrl-x> escape sequences into the
	// textarea. This runs vi to create a file, enters insert mode, types "abc",
	// exits insert mode, and saves+quits:
	//
	//   vi /tmp/tmp_cozy_e2e_test<ctrl-j>  →  open vi, press Enter (start vi)
	//   i                                  →  enter insert mode
	//   abc                                →  type "abc"
	//   <ctrl-[>                           →  Escape (exit insert mode)
	//   :wq<ctrl-j>                        →  save and quit
	//
	// Note: <ctrl-j> is 0x0A (newline / Enter); <ctrl-[> is 0x1B (Escape).
	const tmpFile = "/tmp/tmp_cozy_e2e_test"
	inputString := "vi " + tmpFile + "<ctrl-j>iabc<ctrl-[>:wq<ctrl-j>"

	// The Terminal Input dialog has a multiline textarea (MUI TextField).
	// We fill it with the raw string (the dialog parses <ctrl-x> sequences on send).
	dialogTextarea := page.Locator("div[role='dialog'] textarea").First()
	if err := dialogTextarea.Fill(inputString); err != nil {
		t.Fatalf("failed to fill Terminal Input dialog: %v", err)
	}

	// Press Enter (without Shift) to send — this is what the dialog's onKeyDown
	// handler expects to trigger sendParsedString and close the dialog.
	if err := dialogTextarea.Press("Enter"); err != nil {
		t.Fatalf("failed to press Enter in Terminal Input dialog: %v", err)
	}

	// 5. Wait for the dialog to close, then verify the result.
	// The dialog closes immediately after sending; give the shell time to
	// execute vi (creating the file) and return to the prompt.
	if _, err := page.WaitForSelector("text=Terminal Input", playwright.PageWaitForSelectorOptions{
		State:   playwright.WaitForSelectorStateHidden,
		Timeout: playwright.Float(5000),
	}); err != nil {
		t.Logf("warning: Terminal Input dialog may still be visible: %v", err)
	}

	// Allow enough time for vi to start, execute commands, and exit.
	time.Sleep(3 * time.Second)

	// Verify the file was created by running "cat" on it and checking for "abc".
	_, err := page.Evaluate("() => csSendData('cat " + tmpFile + "\\n')")
	if err != nil {
		t.Fatalf("failed to send cat command: %v", err)
	}

	// The terminal should show the file contents "abc".
	waitForTerminalText(t, page, "abc", 10*time.Second)
	t.Logf("File %s created successfully with content 'abc'", tmpFile)

	// Clean up the temp file.
	_, _ = page.Evaluate("() => csSendData('rm -f " + tmpFile + "\\n')")
}

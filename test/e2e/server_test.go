//go:build integration

package e2e

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mxschmitt/playwright-go"
)

func TestServerManagement(t *testing.T) {
	configDir := setupTestConfig(t)
	sshConfigFile := filepath.Join(configDir, ".ssh", "config")
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	ctx, _ := browser.NewContext()
	page, _ := ctx.NewPage()

	login(t, page, url, "123456")

	// 1. Add New Server
	if err := page.Locator("button[title='New Server']").Click(); err != nil {
		t.Fatalf("failed to click new server: %v", err)
	}

	page.GetByLabel("HostName (IP / Domain)").Fill("192.168.1.100")
	page.GetByLabel("Alias Name").Fill("my-test-server")

	// user & port are rendered as Material UI <Autocomplete>, fill the input and press Enter to change the values
	userInput := page.GetByRole("combobox", playwright.PageGetByRoleOptions{
		Name:  "User",
		Exact: playwright.Bool(true),
	})
	userInput.Fill("ubuntu")
	userInput.Press("Enter")

	portInput := page.GetByRole("combobox", playwright.PageGetByRoleOptions{
		Name:  "Port",
		Exact: playwright.Bool(true),
	})
	portInput.Fill("2222")
	portInput.Press("Enter")

	if err := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Save"}).Click(); err != nil {
		t.Fatalf("failed to click save: %v", err)
	}

	// Wait for the dialog to close and list to update
	time.Sleep(500 * time.Millisecond)

	// Verify ssh config
	content, err := os.ReadFile(sshConfigFile)
	if err != nil {
		t.Fatalf("failed to read ssh config: %v", err)
	}
	contentStr := string(content)
	if !strings.Contains(contentStr, "Host my-test-server") ||
		!strings.Contains(contentStr, "HostName 192.168.1.100") ||
		!strings.Contains(contentStr, "User ubuntu") ||
		!strings.Contains(contentStr, "Port 2222") {
		t.Fatalf("ssh config does not contain expected server data: %s", contentStr)
	}

	// 2. Right click to Edit
	if err := page.Locator("text=my-test-server").First().Click(playwright.LocatorClickOptions{
		Button: playwright.MouseButtonRight,
	}); err != nil {
		t.Fatalf("failed to right click server: %v", err)
	}

	if err := page.GetByText("Edit my-test-server").Click(); err != nil {
		t.Fatalf("failed to click Edit: %v", err)
	}

	// Add a tag
	page.GetByLabel("Tags (Optional)").Fill("database")
	if err := page.GetByRole("button", playwright.PageGetByRoleOptions{Name: "Save"}).Click(); err != nil {
		t.Fatalf("failed to click save: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Verify ssh config for tags
	content, _ = os.ReadFile(sshConfigFile)
	contentStr = string(content)
	if !strings.Contains(contentStr, "### #database") {
		t.Fatalf("ssh config does not contain expected tag annotation: %s", contentStr)
	}

	// 3. Right click to Favourite
	if err := page.Locator("text=my-test-server").First().Click(playwright.LocatorClickOptions{
		Button: playwright.MouseButtonRight,
	}); err != nil {
		t.Fatalf("failed to right click server: %v", err)
	}

	if err := page.GetByText("Add To Favourite").Click(); err != nil {
		t.Fatalf("failed to click Add To Favourite: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Verify ssh config for favourite tag
	content, _ = os.ReadFile(sshConfigFile)
	contentStr = string(content)
	if !strings.Contains(contentStr, "#database") || !strings.Contains(contentStr, "#fav") {
		t.Fatalf("ssh config does not contain fav tag: %s", contentStr)
	}

	// 4. Right click to Unfavourite
	if err := page.Locator("text=my-test-server").First().Click(playwright.LocatorClickOptions{
		Button: playwright.MouseButtonRight,
	}); err != nil {
		t.Fatalf("failed to right click server: %v", err)
	}

	if err := page.GetByText("Remove From Favourite").Click(); err != nil {
		t.Fatalf("failed to click Remove From Favourite: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Verify ssh config for favourite removal
	content, _ = os.ReadFile(sshConfigFile)
	contentStr = string(content)
	if strings.Contains(contentStr, "#fav") {
		t.Fatalf("ssh config still contains fav tag: %s", contentStr)
	}

	// 5. Right click to Delete
	if err := page.Locator("text=my-test-server").First().Click(playwright.LocatorClickOptions{
		Button: playwright.MouseButtonRight,
	}); err != nil {
		t.Fatalf("failed to right click server: %v", err)
	}

	if err := page.GetByText("Delete Host").Click(); err != nil {
		t.Fatalf("failed to click Delete Host: %v", err)
	}

	// The delete uses a MUI confirm dialog (not a native browser confirm).
	// Wait for it and click OK to confirm deletion.
	if err := page.Locator("#async-modal-dialog button:has-text('OK')").WaitFor(); err != nil {
		t.Fatalf("timed out waiting for delete confirm dialog: %v", err)
	}
	if err := page.Locator("#async-modal-dialog button:has-text('OK')").Click(); err != nil {
		t.Fatalf("failed to confirm deletion: %v", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Verify ssh config is empty or doesn't contain the host
	content, err = os.ReadFile(sshConfigFile)
	if err != nil {
		// If it's deleted and file is gone, that's fine too.
	} else {
		contentStr = string(content)
		if strings.Contains(contentStr, "Host my-test-server") {
			t.Fatalf("ssh config still contains deleted server: %s", contentStr)
		}
	}

	ctx.Close()
}

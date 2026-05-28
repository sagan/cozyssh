//go:build integration

package e2e

import (
	"net/http"
	"testing"

	"github.com/go-http-utils/headers"
)

func TestInvalidLogin(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	context, err := browser.NewContext()
	if err != nil {
		t.Fatal(err)
	}
	defer context.Close()

	page, err := context.NewPage()
	if err != nil {
		t.Fatal(err)
	}

	// 1. Open login page
	if _, err := page.Goto(url); err != nil {
		t.Fatal(err)
	}

	// 2. Fill WRONG password
	if err := page.Fill("input[type=\"password\"]", "wrongpassword"); err != nil {
		t.Fatal(err)
	}

	// 3. Click Sign In
	if err := page.Click("button[type=\"submit\"]"); err != nil {
		t.Fatal(err)
	}

	// 4. Login failure now shows a MUI Dialog (not a native browser alert).
	//    Wait for the async-modal-dialog to appear and verify it contains a message.
	dialogLocator := page.Locator("#async-modal-dialog")
	if err := dialogLocator.WaitFor(); err != nil {
		t.Errorf("Timed out waiting for login failure alert: %v", err)
		return
	}

	// Read the dialog title which holds the failure message
	msg, err := page.Locator("#async-modal-dialog .MuiDialogTitle-root").TextContent()
	if err != nil || msg == "" {
		t.Errorf("Expected non-empty failure message in alert dialog, got: %q (err: %v)", msg, err)
	}
	t.Logf("Got expected failure alert: %s", msg)

	// 5. Dismiss the dialog
	if err := page.Locator("#async-modal-dialog button:has-text('OK')").Click(); err != nil {
		t.Logf("Warning: could not click OK on failure dialog: %v", err)
	}
}

func TestAPIUnauthorized(t *testing.T) {
	configDir := setupTestConfig(t)
	url := startTestApp(t, []string{"-config", configDir, "-allow-insecure-http"})

	client := &http.Client{}

	tests := []struct {
		name       string
		path       string
		authHeader string
		wantCode   int
	}{
		{
			name:       "No token",
			path:       "/api/hosts",
			authHeader: "",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "Invalid Bearer token",
			path:       "/api/hosts",
			authHeader: "Bearer invalid-token",
			wantCode:   http.StatusUnauthorized,
		},
		{
			name:       "Invalid query token",
			path:       "/api/hosts?token=invalid",
			authHeader: "",
			wantCode:   http.StatusUnauthorized,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, url+tt.path, nil)
			if tt.authHeader != "" {
				req.Header.Set(headers.Authorization, tt.authHeader)
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatalf("Failed to perform request: %v", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != tt.wantCode {
				t.Errorf("Expected status code %d, but got %d", tt.wantCode, resp.StatusCode)
			}
		})
	}
}

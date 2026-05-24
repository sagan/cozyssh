//go:build integration

package e2e

import (
	"net/http"
	"testing"
	"time"

	"github.com/go-http-utils/headers"
	"github.com/playwright-community/playwright-go"
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

	// 3. Setup listener for the alert
	alertChan := make(chan string, 1)
	page.OnDialog(func(dialog playwright.Dialog) {
		alertChan <- dialog.Message()
		dialog.Dismiss()
	})

	// 4. Click Sign In
	if err := page.Click("button[type=\"submit\"]"); err != nil {
		t.Fatal(err)
	}

	// 5. Verify alert appeared
	select {
	case msg := <-alertChan:
		if msg == "" {
			t.Error("Expected failure alert, but got empty message")
		}
		t.Logf("Got expected failure alert: %s", msg)
	case <-time.After(time.Second * 5):
		t.Error("Timed out waiting for login failure alert")
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

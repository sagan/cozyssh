//go:build integration

package e2e

import (
	"testing"
)

func TestLogin(t *testing.T) {
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

	// 2. Fill password
	if err := page.Fill("input[type=\"password\"]", "123456"); err != nil {
		t.Fatal(err)
	}

	// 3. Click Sign In
	if err := page.Click("button[type=\"submit\"]"); err != nil {
		t.Fatal(err)
	}

	// 4. Verify we are on the dashboard (should see "Filter hosts")
	// Using a locator that waits for the element to appear
	selector := "input[placeholder*=\"Filter hosts\"]"
	if _, err := page.WaitForSelector(selector); err != nil {
		t.Fatalf("Login failed or dashboard not loaded: %v", err)
	}

	t.Log("Login successful!")
}

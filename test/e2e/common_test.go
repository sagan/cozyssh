//go:build integration

package e2e

// go test -tags=integration ./test/e2e/...

import (
	"context"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"cozyssh"

	"github.com/ory/dockertest/v4"
	"github.com/playwright-community/playwright-go"
)

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

func setupTestConfig(t *testing.T) string {
	tmpDir, err := os.MkdirTemp("", "cozyssh-test-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(tmpDir) })

	// bcrypt hashed password of "123456"
	configContent := `
addr: "127.0.0.1:0"
app_password_hash: "$2a$10$DHgtL4m5BTrNIzAUqMF2su7E1LgHvLwwdkoHjVMiFzRnOz5M.TH32"
sshdir: "` + filepath.ToSlash(filepath.Join(tmpDir, ".ssh")) + `"
`
	err = os.WriteFile(filepath.Join(tmpDir, "config.yaml"), []byte(configContent), 0600)
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

	resource, err := pool.Run(ctx, "atmoz/sftp",
		dockertest.WithTag("latest"),
		dockertest.WithCmd([]string{
			fmt.Sprintf("%s:%s:1001", user, password),
		}),
	)
	if err != nil {
		t.Fatalf("Could not start resource: %s", err)
	}

	t.Cleanup(func() {
		if err := resource.Close(ctx); err != nil {
			t.Logf("Could not close resource: %s", err)
		}
	})

	port := resource.GetPort("22/tcp")
	// Wait for SSH to be ready
	addr := net.JoinHostPort("localhost", port)
	for range 50 {
		conn, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return "localhost", port
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("SSH container failed to start in time")
	return "", ""
}

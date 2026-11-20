package ws

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"cozyssh/auth"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/session"
)

func TestHandleTerminalConcurrentPingAndOutput(t *testing.T) {
	auth.Init(&config.Config{
		AppPasswordHash: "test-hash",
		SessionSecret:   "test-secret",
	})

	origPing := wsPingInterval
	origPong := wsPongTimeout
	wsPingInterval = 2 * time.Millisecond
	wsPongTimeout = 200 * time.Millisecond
	defer func() {
		wsPingInterval = origPing
		wsPongTimeout = origPong
	}()

	pr, pw := io.Pipe()
	sessionID := "test-concurrent-ws"
	s := session.NewSession(sessionID, "test-host", pr, io.Discard, func() error {
		pw.Close()
		pr.Close()
		return nil
	}, func(rows, cols uint16) error {
		return nil
	})
	session.GlobalManager.Add(s)
	defer func() {
		s.Close()
		session.GlobalManager.Remove(sessionID)
	}()

	srv := httptest.NewServer(http.HandlerFunc(HandleTerminal))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "?" + constants.VAR_TOKEN + "=" + auth.GenerateToken()
	queryParam := base64.RawURLEncoding.EncodeToString([]byte("sessionId=" + sessionID))

	dialer := websocket.Dialer{
		Subprotocols: []string{constants.WS_PROTOCOL_QUERY_PREFIX + queryParam},
	}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer conn.Close()

	// Drain incoming messages on the client so the server keeps writing.
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// Stream high-frequency output (simulating a TUI like opencode) while
	// the ping ticker is firing concurrently.
	payload := []byte("\x1b[2J\x1b[Hstreaming-tui-frame-update\r\n")
	for range 200 {
		if _, err := pw.Write(payload); err != nil {
			t.Fatalf("pipe write failed: %v", err)
		}
		time.Sleep(time.Millisecond)
	}

	conn.Close()
	<-readDone
}

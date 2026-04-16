package ws

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"

	"cozyssh/auth"
	"cozyssh/config"
	"cozyssh/localpty"
	"cozyssh/session"
	"cozyssh/sshmanager"
)

var globalConfig *config.Config

func SetConfig(cfg *config.Config) {
	globalConfig = cfg
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Could restrict to same-origin in production
	},
}

type WsMsg struct {
	Type string `json:"type"` // "resize"
	Cols uint16 `json:"cols,omitempty"`
	Rows uint16 `json:"rows,omitempty"`
}

type WsTerminal struct {
	conn *websocket.Conn
}

func (w *WsTerminal) Print(msg string) {
	w.conn.WriteMessage(websocket.BinaryMessage, []byte(strings.ReplaceAll(msg, "\n", "\r\n")))
}

func (w *WsTerminal) Prompt(msg string) (string, error) {
	w.Print(msg)
	var buf []byte
	for {
		mt, data, err := w.conn.ReadMessage()
		if err != nil {
			return "", err
		}
		if mt == websocket.BinaryMessage {
			for _, b := range data {
				if b == '\r' || b == '\n' {
					w.Print("\r\n")
					return string(buf), nil
				} else if b == 127 || b == '\b' {
					if len(buf) > 0 {
						buf = buf[:len(buf)-1]
						w.conn.WriteMessage(websocket.BinaryMessage, []byte("\b \b"))
					}
				} else if b == 3 { // Ctrl+C
					w.Print("^C\r\n")
					return "", fmt.Errorf("cancelled")
				} else {
					buf = append(buf, b)
					w.conn.WriteMessage(websocket.BinaryMessage, []byte{b})
				}
			}
		}
	}
}

func HandleTerminal(w http.ResponseWriter, r *http.Request) {
	if !auth.WSAuth(r) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("upgrade error:", err)
		return
	}
	defer conn.Close()

	host := r.URL.Query().Get("host")
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		sessionID = host // Fallback to host if no unique ID provided
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		if host == "" || host == "local" {
			ls, err := localpty.Start()
			if err != nil {
				log.Println("pty start error:", err)
				return
			}
			s = session.NewSession(sessionID, host, ls.PtyFile, ls.PtyFile, ls.Close, ls.Resize)
		} else {
			conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"state","state":"connecting to ssh server"}`))
			term := &WsTerminal{conn: conn}
			client, sshSession, err := sshmanager.DialSSH(host, term)
			if err != nil {
				log.Println("SSH dial error:", err)
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") {
					conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"state","state":"disconnected (fatal)"}`))
				}
				return
			}
			stdout, _ := sshSession.StdoutPipe()
			stdin, _ := sshSession.StdinPipe()
			if err := sshSession.Shell(); err != nil {
				log.Println("Shell err:", err)
				return
			}
			s = session.NewSession(sessionID, host, stdout, stdin, func() error {
				sshSession.Close()
				return client.Close()
			}, func(rows, cols uint16) error {
				return sshSession.WindowChange(int(rows), int(cols))
			})
			
			s.RetryFunc = func() (io.Reader, io.Writer, error) {
				// We can push connecting state to all listeners
				s.Broadcast(append([]byte("STATE:"), []byte(`{"type":"state","state":"disconnected to ssh server"}`)...))
				
				newClient, newSess, err := sshmanager.DialSSH(host, nil)
				if err != nil {
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") || strings.Contains(errStr, "interactive") {
						return nil, nil, fmt.Errorf("fatal: %v", err)
					}
					return nil, nil, err
				}
				nr, _ := newSess.StdoutPipe()
				nw, _ := newSess.StdinPipe()
				if err := newSess.Shell(); err != nil {
					newSess.Close()
					newClient.Close()
					return nil, nil, err
				}
				s.CloseFunc = func() error {
					newSess.Close()
					return newClient.Close()
				}
				s.ResizeFunc = func(rows, cols uint16) error {
					return newSess.WindowChange(int(rows), int(cols))
				}
				sshSession.Close()
				client.Close()
				client = newClient
				sshSession = newSess
				
				s.Broadcast(append([]byte("STATE:"), []byte(`{"type":"state","state":"connected"}`)...))
				
				return nr, nw, nil
			}
		}
		
		if globalConfig != nil {
			for _, pt := range globalConfig.PinnedTabs {
				if pt.ID == sessionID {
					s.Pinned = true
					break
				}
			}
		}
		
		session.GlobalManager.Add(s)
	}

	session.GlobalManager.CancelDisconnectTimer(sessionID)
	listener, history := s.AddListener()
	defer session.GlobalManager.RemoveListener(sessionID, listener)

	conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"state","state":"connected"}`))

	// Send history first
	if len(history) > 0 {
		conn.WriteMessage(websocket.BinaryMessage, history)
	}

	// Session internal read loop handles writing to listeners
	go func() {
		for data := range listener {
			if len(data) > 6 && string(data[:6]) == "STATE:" {
				if err := conn.WriteMessage(websocket.TextMessage, data[6:]); err != nil {
					break
				}
				continue
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
				break
			}
		}
	}()

	for {
		mt, msg, connErr := conn.ReadMessage()
		if connErr != nil {
			break
		}
		if mt == websocket.TextMessage {
			var wmsg WsMsg
			if err := json.Unmarshal(msg, &wmsg); err == nil && wmsg.Type == "resize" {
				s.Resize(wmsg.Rows, wmsg.Cols)
			}
		} else if mt == websocket.BinaryMessage {
			s.Writer.Write(msg)
		}
	}
}

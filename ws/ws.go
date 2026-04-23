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

	"golang.org/x/crypto/ssh"
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
	return w.prompt(msg, false)
}

func (w *WsTerminal) PromptMasked(msg string) (string, error) {
	return w.prompt(msg, true)
}

func (w *WsTerminal) prompt(msg string, masked bool) (string, error) {
	w.Print(msg)
	var buf []byte
	for {
		mt, data, err := w.conn.ReadMessage()
		if err != nil {
			return "", err
		}
		if mt == websocket.BinaryMessage {
			for _, b := range data {
				switch b {
				case '\r', '\n':
					w.Print("\r\n")
					return string(buf), nil
				case 127, '\b':
					if len(buf) > 0 {
						buf = buf[:len(buf)-1]
						if !masked {
							w.conn.WriteMessage(websocket.BinaryMessage, []byte("\b \b"))
						}
					}
				case 3: // Ctrl+C
					w.Print("^C\r\n")
					return "", fmt.Errorf("cancelled")
				default:
					buf = append(buf, b)
					if !masked {
						w.conn.WriteMessage(websocket.BinaryMessage, []byte{b})
					}
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

	reconnect := r.URL.Query().Get("reconnect") == "true"
	cloneFrom := r.URL.Query().Get("cloneFrom")
	host := r.URL.Query().Get("host")
	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		sessionID = host // Fallback to host if no unique ID provided
	}

	if reconnect {
		if s := session.GlobalManager.Get(sessionID); s != nil {
			s.Close()
			session.GlobalManager.Remove(sessionID)
		}
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		if host == "" || host == "local" {
			ls, err := localpty.Start()
			if err != nil {
				log.Println("pty start error:", err)
				return
			}
			s = session.NewSession(sessionID, host, ls.Pty, ls.Pty, ls.Close, ls.Resize)
		} else {
			conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"state","state":"connecting to ssh server"}`))
			term := &WsTerminal{conn: conn}

			var pClient *sshmanager.PooledClient
			var sshSession *ssh.Session
			var err error

			if cloneFrom != "" {
				if parent := session.GlobalManager.Get(cloneFrom); parent != nil {
					if pc, ok := parent.SSHClient.(*sshmanager.PooledClient); ok {
						pClient = pc
						sshSession, err = sshmanager.CloneSSH(pClient)
					}
				}
			}

			if pClient == nil {
				pClient, sshSession, err = sshmanager.DialSSH(host, term)
			}

			if err != nil {
				log.Println("SSH dial/clone error:", err)
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
				pClient.Release()
				return
			}
			s = session.NewSession(sessionID, host, stdout, stdin, func() error {
				sshSession.Close()
				pClient.Release()
				return nil
			}, func(rows, cols uint16) error {
				return sshSession.WindowChange(int(rows), int(cols))
			})
			s.SSHClient = pClient

			s.RetryFunc = func() (io.Reader, io.Writer, error) {
				s.Broadcast(append([]byte("STATE:"), []byte(`{"type":"state","state":"disconnected to ssh server"}`)...))

				newPClient, newSess, err := sshmanager.DialSSH(host, nil)
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
					newPClient.Release()
					return nil, nil, err
				}
				s.CloseFunc = func() error {
					newSess.Close()
					newPClient.Release()
					return nil
				}
				s.ResizeFunc = func(rows, cols uint16) error {
					return newSess.WindowChange(int(rows), int(cols))
				}
				sshSession.Close()
				pClient.Release()
				pClient = newPClient
				sshSession = newSess
				s.SSHClient = pClient

				s.Broadcast(append([]byte("STATE:"), []byte(`{"type":"state","state":"connected"}`)...))

				return nr, nw, nil
			}
		}
		session.GlobalManager.Add(s)
	} else {
		// Taking over an existing session
		s.Steal()
	}

	// Always sync pinned status from config if possible
	if globalConfig != nil {
		for _, pt := range globalConfig.PinnedTabs {
			if pt.ID == sessionID {
				s.Pinned = true
				break
			}
		}
	}

	session.GlobalManager.CancelDisconnectTimer(sessionID)
	listener, history := s.AddListener()
	defer session.GlobalManager.RemoveListener(sessionID, listener)

	conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"state","state":"connected"}`))

	// Send history first
	if len(history) > 0 {
		conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"history_start"}`))
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
		switch mt {
		case websocket.TextMessage:
			var wmsg WsMsg
			if err := json.Unmarshal(msg, &wmsg); err == nil && wmsg.Type == "resize" {
				s.Resize(wmsg.Rows, wmsg.Cols)
			}
		case websocket.BinaryMessage:
			s.Writer.Write(msg)
		}
	}
}

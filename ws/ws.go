package ws

import (
	"encoding/json"
	"log"
	"net/http"

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
			client, sshSession, err := sshmanager.DialSSH(host)
			if err != nil {
				log.Println("SSH dial error:", err)
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

	listener, history := s.AddListener()
	defer session.GlobalManager.RemoveListener(sessionID, listener)

	// Send history first
	if len(history) > 0 {
		conn.WriteMessage(websocket.BinaryMessage, history)
	}

	// Session internal read loop handles writing to listeners
	go func() {
		for data := range listener {
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

package ws

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"cozyssh/auth"
	"cozyssh/common"
	"cozyssh/config"
	"cozyssh/constants"
	"cozyssh/localpty"
	"cozyssh/models"
	"cozyssh/session"
	"cozyssh/sshmanager"
)

var globalConfig *config.Config

func SetConfig(cfg *config.Config) {
	globalConfig = cfg
}

var upgrader = websocket.Upgrader{
	CheckOrigin: common.IsSameOrigin,
}

type WsMsg struct {
	Type string `json:"type"` // "resize"
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
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

	var query url.Values
	identity := ""
	if protocols := r.Header.Get(constants.HEADER_SEC_WEBSOCKET_PROTOCOL); protocols != "" {
		parts := strings.SplitSeq(protocols, ",")
		for p := range parts {
			p = strings.TrimSpace(p)
			if strings.HasPrefix(p, constants.WS_PROTOCOL_QUERY_PREFIX) {
				// Only accepts query from ws protocol header to avoid logging.
				if data, err := base64.RawURLEncoding.DecodeString(
					p[len(constants.WS_PROTOCOL_QUERY_PREFIX):]); err == nil && len(data) > 0 {
					if q, err := url.ParseQuery(string(data)); err == nil {
						query = q
					}
				}
			} else if strings.HasPrefix(p, constants.WS_PROTOCOL_IDENTITY_PREFIX) {
				if data, err := base64.RawURLEncoding.DecodeString(
					p[len(constants.WS_PROTOCOL_IDENTITY_PREFIX):]); err == nil && len(data) > 0 {
					identity = strings.TrimSpace(string(data))
					if !strings.Contains(identity, "\n") && !strings.HasPrefix(identity, "-----") {
						if content, err := os.ReadFile(common.ExpandPath(identity)); err == nil {
							identity = string(content)
						} else {
							identity = ""
						}
					}
				}
			}
		}
	}
	if query == nil {
		http.Error(w, "Missing or invalid query parameter", http.StatusBadRequest)
		return
	}

	header := http.Header{
		constants.HEADER_SEC_WEBSOCKET_PROTOCOL: []string{constants.WS_PROTOCOL_DUMMY},
	}
	conn, err := upgrader.Upgrade(w, r, header)
	if err != nil {
		return
	}
	defer conn.Close()

	reconnect := query.Get("reconnect") == "1"
	cloneFrom := query.Get("cloneFrom")
	host := query.Get("host")
	sessionID := query.Get("sessionId")
	cols, _ := strconv.Atoi(query.Get("cols"))
	rows, _ := strconv.Atoi(query.Get("rows"))
	sessionProxyJump := query.Get("proxyJump")
	sessionRemoteCommand := query.Get("remoteCommand")
	noPublicKey := query.Get("noPublicKey") == "1"

	user := common.User
	// sessionID fallbacks to hostname if no unique ID provided
	if i := strings.LastIndex(host, "@"); i != -1 {
		if sessionID == "" {
			sessionID = host[i+1:]
		}
		user, _, _ = strings.Cut(host[0:i], ":")
		if _u, err := url.PathUnescape(user); err == nil {
			user = _u
		}
	} else if sessionID == "" {
		sessionID = host
	}

	if reconnect {
		if s := session.GlobalManager.Get(sessionID); s != nil {
			s.Close()
			session.GlobalManager.Remove(sessionID)
		}
	}

	s := session.GlobalManager.Get(sessionID)
	if s == nil {
		if host == "" || host == constants.LOCAL_NAME {
			ls, err := localpty.Start(sessionRemoteCommand)
			if err != nil {
				return
			}
			s = session.NewSession(sessionID, host, ls.Pty, ls.Pty, ls.Close, ls.Resize)
		} else {
			conn.WriteMessage(websocket.TextMessage, models.WsMsgStateConnecting)
			term := &WsTerminal{conn: conn}

			var pClient *sshmanager.PooledClient
			var sshSession *ssh.Session
			var remoteCommand string
			var err error

			if cloneFrom != "" {
				if parent := session.GlobalManager.Get(cloneFrom); parent != nil {
					if pc, ok := parent.SSHClient.(*sshmanager.PooledClient); ok {
						pClient = pc
						sshSession, remoteCommand, err = sshmanager.CloneSSH(pClient, rows, cols)
					}
				}
			}

			if pClient == nil {
				pClient, sshSession, remoteCommand, err = sshmanager.DialSSH(host, term, rows, cols, identity,
					sessionProxyJump, noPublicKey)
			}

			if err != nil {
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") {
					conn.WriteMessage(websocket.TextMessage, models.WsMsgStateDisconnectedFatal)
				}
				return
			}
			stdout, _ := sshSession.StdoutPipe()
			stdin, _ := sshSession.StdinPipe()

			if sessionRemoteCommand != "" {
				remoteCommand = sessionRemoteCommand
			}

			if remoteCommand != "" {
				// Expand tokens
				// We need host, port, user from the client
				// The pClient doesn't directly expose them but we have the 'host' name and we can guess or use what was used.
				// Actually, it's better if getSSHClient returns them or we store them.
				// For now, let's just use the host name for expansion.
				expanded := sshmanager.ExpandTokens(remoteCommand, host, "22", user, host, sessionID)
				if err := sshSession.Start(expanded); err != nil {
					pClient.Release()
					return
				}
			} else {
				if err := sshSession.Shell(); err != nil {
					pClient.Release()
					return
				}
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
				s.Broadcast(append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateDisconnected...))

				newPClient, newSess, newRC, err := sshmanager.DialSSH(host, nil, rows, cols, identity,
					sessionProxyJump, noPublicKey)
				if err != nil {
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") ||
						strings.Contains(errStr, "interactive") {
						return nil, nil, fmt.Errorf("fatal: %v", err)
					}
					return nil, nil, err
				}
				nr, _ := newSess.StdoutPipe()
				nw, _ := newSess.StdinPipe()

				if newRC != "" {
					expanded := sshmanager.ExpandTokens(newRC, host, "22", user, host, sessionID)
					if err := newSess.Start(expanded); err != nil {
						newSess.Close()
						newPClient.Release()
						return nil, nil, err
					}
				} else {
					if err := newSess.Shell(); err != nil {
						newSess.Close()
						newPClient.Release()
						return nil, nil, err
					}
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

				s.Broadcast(append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateConnected...))

				return nr, nw, nil
			}
		}
		session.GlobalManager.Add(s)
	} else {
		// Taking over an existing session
		s.Steal()
		if cols > 0 && rows > 0 {
			s.Resize(uint16(rows), uint16(cols))
		}
	}

	session.GlobalManager.CancelDisconnectTimer(sessionID)
	listener, history := s.AddListener()
	defer session.GlobalManager.RemoveListener(sessionID, listener)

	conn.WriteMessage(websocket.TextMessage, models.WsMsgStateConnected)

	// Send history first
	if len(history) > 0 {
		conn.WriteMessage(websocket.TextMessage, models.WsMsgHistoryStart)
		conn.WriteMessage(websocket.BinaryMessage, history)
	}

	conn.WriteMessage(websocket.TextMessage, models.GetWsTabStateMsg(s.IsPinned, s.IsLocked))

	// Keepalive: send a WebSocket ping every 30 s and require a pong within
	// 10 s. Without this, silently-dead TCP connections (browser crash, mobile
	// sleep, network cut) keep conn.ReadMessage() blocked forever, preventing
	// the deferred RemoveListener from firing and leaving bash/SSH processes
	// alive indefinitely.
	const wsPingInterval = 30 * time.Second
	const wsPongTimeout = 10 * time.Second
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(wsPingInterval + wsPongTimeout))
		return nil
	})
	// Set an initial deadline so the first ping has a window to be answered.
	conn.SetReadDeadline(time.Now().Add(wsPingInterval + wsPongTimeout))
	go func() {
		ticker := time.NewTicker(wsPingInterval)
		defer ticker.Stop()
		for range ticker.C {
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}()

	// Session internal read loop handles writing to listeners
	go func() {
		for data := range listener {
			if len(data) > len(models.WS_MSG_PREFIX_STATE) &&
				string(data[:len(models.WS_MSG_PREFIX_STATE)]) == models.WS_MSG_PREFIX_STATE {
				if err := conn.WriteMessage(websocket.TextMessage, data[len(models.WS_MSG_PREFIX_STATE):]); err != nil {
					break
				}
				continue
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
				break
			}
		}
		// The session's listener channel was closed (session ended or was removed).
		// Close the WebSocket so the frontend's ws.onclose handler fires, allowing
		// it to show a reconnect tip or auto-reconnect as appropriate.
		conn.Close()
	}()

	for {
		mt, msg, connErr := conn.ReadMessage()
		if connErr != nil {
			break
		}
		switch mt {
		case websocket.TextMessage:
			var wmsg models.WsResizeMsg
			if err := json.Unmarshal(msg, &wmsg); err == nil && wmsg.Type == models.WsTerminalMessageTypeResize {
				s.Resize(wmsg.Rows, wmsg.Cols)
			}
		case websocket.BinaryMessage:
			s.Writer.Write(msg)
		}
	}
}

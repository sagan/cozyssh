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
	"cozyssh/recents"
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
	execFlag := query.Get("exec") == "1"
	noPublicKey := query.Get("noPublicKey") == "1"
	shellIntegrationFlag := query.Get("shellIntegration")
	localForwards := strings.Join(query["localForward"], "\n")
	remoteForwards := strings.Join(query["remoteForward"], "\n")
	dynamicForwards := strings.Join(query["dynamicForward"], "\n")
	var env []string
	if query.Has("env") {
		env = strings.Split(strings.Join(query["env"], "\n"), "\n")
	}

	user := common.User
	hostWithoutPass := host
	if i := strings.LastIndex(host, "@"); i != -1 {
		user, _, _ = strings.Cut(host[0:i], ":")
		if _u, err := url.PathUnescape(user); err == nil {
			user = _u
		}
		hostWithoutPass = user + "@" + host[i+1:]
	}
	if sessionID == "" {
		sessionID = "s-" + common.RandString(12, false)
	}

	if query.Get("_updateRecent") == "1" {
		recents.Add(hostWithoutPass)
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
			ls, err := localpty.Start(sessionRemoteCommand, execFlag, shellIntegrationFlag, env)
			if err != nil {
				return
			}
			s = session.NewSession(sessionID, host, ls.Pty, ls.Pty, ls.Close, ls.Resize)
			s.CanonicalHostString = constants.LOCAL_NAME
		} else {
			conn.WriteMessage(websocket.TextMessage, models.WsMsgStateConnecting)
			term := &WsTerminal{conn: conn}

			var pClient *sshmanager.PooledClient
			var sshSession *ssh.Session
			var canonicalHostString string
			var remoteCommand string
			var err error

			if cloneFrom != "" {
				if parent := session.GlobalManager.Get(cloneFrom); parent != nil && parent.SSHClient != nil {
					pClient = parent.SSHClient
					sshSession, remoteCommand, err = sshmanager.CloneSSH(pClient, rows, cols)
				}
			}

			if pClient == nil {
				pClient, sshSession, canonicalHostString, remoteCommand, err = sshmanager.DialSSH(host, term, rows, cols, identity,
					sessionProxyJump, noPublicKey, env)
			}

			if err != nil {
				errStr := strings.ToLower(err.Error())
				if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") || strings.Contains(errStr, "unexpected message type 51") {
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
				expandedRemoteCommand := sshmanager.ExpandTokens(remoteCommand, host, "22", user, host, sessionID)
				if err := sshSession.Start(expandedRemoteCommand); err != nil {
					pClient.Release()
					return
				}

				shellName, isShell := localpty.DetectShell(expandedRemoteCommand)
				doInjection := false
				switch shellIntegrationFlag {
				case "2": // force inect
					doInjection = true
				case "", "1": // auto, inject
					if isShell && shellName != "sh" {
						doInjection = true
					}
				}
				if doInjection {
					stdout = localpty.InjectRemoteShellIntegration(stdin, stdout)
				}
			} else {
				if err := sshSession.Shell(); err != nil {
					pClient.Release()
					return
				}

				shellIntegrationType := pClient.ShellIntegrationType()
				doInjection := false
				switch shellIntegrationFlag {
				case "2": // force inect
					doInjection = true
				case "", "1": // auto, inject
					if shellIntegrationType == 0 || shellIntegrationType == 2 {
						doInjection = true
					}
				}
				if doInjection {
					stdout = localpty.InjectRemoteShellIntegration(stdin, stdout)
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
			s.CanonicalHostString = canonicalHostString

			var localFwd, remoteFwd, dynamicFwd string
			if localForwards != "" || remoteForwards != "" || dynamicForwards != "" {
				localFwd = localForwards
				remoteFwd = remoteForwards
				dynamicFwd = dynamicForwards
			} else {
				localFwd, remoteFwd, dynamicFwd = sshmanager.GetHostForwardRules(host)
			}
			if localFwd != "" || remoteFwd != "" || dynamicFwd != "" {
				if localFwd != "" {
					localFwd = sshmanager.ExpandTokens(localFwd, host, "22", user, host, sessionID)
				}
				if remoteFwd != "" {
					remoteFwd = sshmanager.ExpandTokens(remoteFwd, host, "22", user, host, sessionID)
				}
				hostKey := sshmanager.GetHostCanonicalKey(host)
				cleanupTunnels := sshmanager.SetupPortForwarding(pClient.Client, host, hostKey, localFwd, remoteFwd, dynamicFwd)
				originalClose := s.CloseFunc
				s.CloseFunc = func() error {
					cleanupTunnels()
					return originalClose()
				}
			}

			s.RetryFunc = func() (io.Reader, io.Writer, error) {
				s.Broadcast(append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateDisconnected...))

				newPClient, newSess, newCanonicalHostString, newRemoteCommand, err := sshmanager.DialSSH(host, nil, rows, cols, identity,
					sessionProxyJump, noPublicKey, env)
				if err != nil {
					errStr := strings.ToLower(err.Error())
					if strings.Contains(errStr, "mismatch") || strings.Contains(errStr, "auth") ||
						strings.Contains(errStr, "interactive") || strings.Contains(errStr, "unexpected message type 51") {
						return nil, nil, fmt.Errorf("fatal: %v", err)
					}
					return nil, nil, err
				}
				nr, _ := newSess.StdoutPipe()
				nw, _ := newSess.StdinPipe()

				if newRemoteCommand != "" {
					expandedRemoteCommand := sshmanager.ExpandTokens(newRemoteCommand, host, "22", user, host, sessionID)
					if err := newSess.Start(expandedRemoteCommand); err != nil {
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
				s.CanonicalHostString = newCanonicalHostString

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
	if query.Has("state") {
		state, _ := strconv.Atoi(query.Get("state"))
		s.SetState(state)
	} else {
		_, _, isHidden := s.GetState()
		if isHidden {
			s.SetState(2)
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

	isPinned, isLocked, isHidden := s.GetState()
	conn.WriteMessage(websocket.TextMessage, models.GetWsTabStateMsg(isPinned, isLocked, isHidden))

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

package session

import (
	"cozyssh/models"
	"cozyssh/sshmanager"
	"errors"
	"io"
	"strings"
	"sync"
	"time"
)

// CircularBuffer stores a fixed amount of terminal output.
type CircularBuffer struct {
	mu   sync.RWMutex
	data []byte
	max  int
}

func NewCircularBuffer(max int) *CircularBuffer {
	return &CircularBuffer{
		data: make([]byte, 0, max),
		max:  max,
	}
}

func (b *CircularBuffer) Write(p []byte) (n int, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.data = append(b.data, p...)
	if len(b.data) > b.max {
		b.data = b.data[len(b.data)-b.max:]
	}
	return len(p), nil
}

func (b *CircularBuffer) Bytes() []byte {
	b.mu.RLock()
	defer b.mu.RUnlock()
	res := make([]byte, len(b.data))
	copy(res, b.data)
	return res
}

// Session represents a persistent terminal session (PTY or SSH).
type Session struct {
	ID         string
	Host       string
	Title      string
	IsPinned   bool
	IsLocked   bool
	Reader     io.Reader
	Writer     io.Writer
	CloseFunc  func() error
	ResizeFunc func(rows, cols uint16) error
	RetryFunc  func() (io.Reader, io.Writer, error)
	Buffer     *CircularBuffer
	SSHClient  *sshmanager.PooledClient

	mu        sync.Mutex
	listeners []chan []byte
}

func NewSession(id, host string, r io.Reader, w io.Writer, closeFunc func() error, resizeFunc func(rows, cols uint16) error) *Session {
	s := &Session{
		ID:         id,
		Host:       host,
		Reader:     r,
		Writer:     w,
		CloseFunc:  closeFunc,
		ResizeFunc: resizeFunc,
		Buffer:     NewCircularBuffer(50000), // ~50KB buffer
		listeners:  make([]chan []byte, 0),
	}

	go s.run()
	return s
}

func (s *Session) Resize(rows, cols uint16) error {
	if s.ResizeFunc != nil {
		return s.ResizeFunc(rows, cols)
	}
	return nil
}

func (s *Session) run() {
	buf := make([]byte, 1024)
	for {
		n, err := s.Reader.Read(buf)
		if n > 0 {
			data := make([]byte, n)
			copy(data, buf[:n])
			s.Buffer.Write(data)

			s.mu.Lock()
			for _, l := range s.listeners {
				// Non-blocking send
				select {
				case l <- data:
				default:
				}
			}
			s.mu.Unlock()
		}
		if err != nil {
			// io.EOF means the process exited cleanly (user typed "exit",
			// or a remoteCommand finished). Don't retry — just notify the
			// frontend so it can show a "reconnect" prompt instead of
			// auto-reconnecting.
			normalExit := errors.Is(err, io.EOF)

			if !normalExit && s.RetryFunc != nil {
				// Network / unexpected error: attempt reconnection.
				reconnected := false
				for range 30 { // Retry up to 30 times (~1 min)
					time.Sleep(3 * time.Second)
					nr, nw, rErr := s.RetryFunc()
					if rErr != nil {
						errStr := strings.ToLower(rErr.Error())
						if strings.Contains(errStr, "authenticate") || strings.Contains(errStr, "auth") ||
							strings.Contains(errStr, "mismatch") || strings.HasPrefix(errStr, "fatal:") {
							s.Broadcast(append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateDisconnectedFatal...))
							break
						}
						continue
					}
					s.Reader = nr
					s.Writer = nw
					reconnected = true
					break
				}
				if reconnected {
					continue
				}
			}

			// Broadcast "exited" for clean exits so the frontend shows a
			// reconnect prompt rather than auto-reconnecting.
			if normalExit {
				s.Broadcast(append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateExited...))
			}

			s.mu.Lock()
			for _, l := range s.listeners {
				close(l)
			}
			s.listeners = nil
			s.mu.Unlock()
			GlobalManager.Remove(s.ID)
			break
		}
	}
}

func (s *Session) AddListener() (chan []byte, []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch := make(chan []byte, 10240) // 10KB buffer for each session
	s.listeners = append(s.listeners, ch)
	return ch, s.Buffer.Bytes()
}

func (s *Session) RemoveListener(ch chan []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, l := range s.listeners {
		if l == ch {
			s.listeners = append(s.listeners[:i], s.listeners[i+1:]...)
			close(ch) // unblock the ws write goroutine so it can exit
			break
		}
	}
}

func (s *Session) Broadcast(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, l := range s.listeners {
		select {
		case l <- data:
		default:
		}
	}
}

func (s *Session) BroadcastTabState() {
	s.mu.Lock()
	stateMsg := append([]byte(models.WS_MSG_PREFIX_STATE), models.GetWsTabStateMsg(s.IsPinned, s.IsLocked)...)
	for _, l := range s.listeners {
		select {
		case l <- stateMsg:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *Session) Close() error {
	return s.CloseFunc()
}

func (s *Session) Steal() {
	s.mu.Lock()
	stolenMsg := append([]byte(models.WS_MSG_PREFIX_STATE), models.WsMsgStateStolen...)
	for _, l := range s.listeners {
		select {
		case l <- stolenMsg:
		default:
		}
		close(l)
	}
	s.listeners = nil
	s.mu.Unlock()
}

func (s *Session) ListenerCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.listeners)
}

// SessionManager manages active sessions.
type SessionManager struct {
	mu               sync.Mutex
	sessions         map[string]*Session
	disconnectTimers map[string]*time.Timer
}

var GlobalManager = &SessionManager{
	sessions:         make(map[string]*Session),
	disconnectTimers: make(map[string]*time.Timer),
}

func (m *SessionManager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *SessionManager) Remove(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, id)
	if timer, ok := m.disconnectTimers[id]; ok {
		timer.Stop()
		delete(m.disconnectTimers, id)
	}
}

func (m *SessionManager) CloseIfNotLocked(id string) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()

	if ok {
		s.mu.Lock()
		locked := s.IsLocked
		s.mu.Unlock()

		if !locked {
			s.Close()
			m.Remove(id)
		}
	}
}

func (m *SessionManager) CloseAllNormal() {
	m.mu.Lock()
	var toClose []*Session
	for _, s := range m.sessions {
		s.mu.Lock()
		if !s.IsLocked {
			toClose = append(toClose, s)
		}
		s.mu.Unlock()
	}
	m.mu.Unlock()

	for _, s := range toClose {
		s.Close()
		m.Remove(s.ID)
	}
}

func (m *SessionManager) Add(s *Session) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[s.ID] = s
}

func (m *SessionManager) RemoveListener(id string, ch chan []byte) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	m.mu.Unlock()

	if ok {
		s.RemoveListener(ch)
		m.ClearInactive(id)
	}
}

func (m *SessionManager) ClearInactive(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[id]; ok {
		s.mu.Lock()
		listenerCount := len(s.listeners)
		isPinned := s.IsPinned || s.IsLocked
		s.mu.Unlock()

		if !isPinned && listenerCount == 0 {
			// Start 1 minute timer before closing
			if _, exists := m.disconnectTimers[id]; !exists {
				m.disconnectTimers[id] = time.AfterFunc(1*time.Minute, func() {
					m.mu.Lock()
					defer m.mu.Unlock()
					// Check again
					if sess, stillOk := m.sessions[id]; stillOk {
						sess.mu.Lock()
						lCount := len(sess.listeners)
						sess.mu.Unlock()
						if lCount == 0 {
							sess.Close()
							delete(m.sessions, id)
						}
					}
					delete(m.disconnectTimers, id)
				})
			}
		}
	}
}

func (m *SessionManager) CancelDisconnectTimer(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if timer, ok := m.disconnectTimers[id]; ok {
		timer.Stop()
		delete(m.disconnectTimers, id)
	}
}

func (m *SessionManager) GetPinned() []*models.SessionPinned {
	m.mu.Lock()
	defer m.mu.Unlock()
	var pinned []*models.SessionPinned
	for _, s := range m.sessions {
		s.mu.Lock()
		if s.IsPinned || s.IsLocked {
			pinned = append(pinned, &models.SessionPinned{
				Id:            s.ID,
				Host:          s.Host,
				Title:         s.Title,
				IsLocked:      s.IsLocked,
				ListenerCount: len(s.listeners),
			})
		}
		s.mu.Unlock()
	}
	return pinned
}

func (m *SessionManager) DisconnectAllWebsockets() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.sessions {
		s.mu.Lock()
		for _, l := range s.listeners {
			close(l)
		}
		s.listeners = nil
		s.mu.Unlock()
	}
}

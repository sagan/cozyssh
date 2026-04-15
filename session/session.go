package session

import (
	"io"
	"log"
	"sync"
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
	ID        string
	Host      string
	Pinned    bool
	Reader     io.Reader
	Writer     io.Writer
	CloseFunc  func() error
	ResizeFunc func(rows, cols uint16) error
	Buffer     *CircularBuffer
	
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
			if err != io.EOF {
				log.Printf("Session %s read error: %v", s.ID, err)
			}
			s.mu.Lock()
			for _, l := range s.listeners {
				close(l)
			}
			s.listeners = nil
			s.mu.Unlock()
			// If session is pinned, we might want it to auto-restart? 
			// For now, if the process dies, the session is dead.
			break
		}
	}
}

func (s *Session) AddListener() (chan []byte, []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	ch := make(chan []byte, 100)
	s.listeners = append(s.listeners, ch)
	return ch, s.Buffer.Bytes()
}

func (s *Session) RemoveListener(ch chan []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	for i, l := range s.listeners {
		if l == ch {
			s.listeners = append(s.listeners[:i], s.listeners[i+1:]...)
			break
		}
	}
}

func (s *Session) Close() error {
	return s.CloseFunc()
}

// SessionManager manages active sessions.
type SessionManager struct {
	mu       sync.Mutex
	sessions map[string]*Session
}

var GlobalManager = &SessionManager{
	sessions: make(map[string]*Session),
}

func (m *SessionManager) Get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
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
		isPinned := s.Pinned
		s.mu.Unlock()
		
		if !isPinned && listenerCount == 0 {
			s.Close()
			delete(m.sessions, id)
		}
	}
}

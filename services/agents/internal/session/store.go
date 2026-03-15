package session

import (
	"sync"
	"time"
)

// SessionState represents the lifecycle state of a session.
type SessionState int

const (
	StateCreating   SessionState = iota + 1 // 1
	StateRunning                            // 2
	StateStopped                            // 3
	StateError                              // 4
	StateDestroying                         // 5
)

// Session represents an agent session in the internal domain.
type Session struct {
	ID           string
	Name         string
	AgentProfile string
	State        SessionState
	TmuxSession  string
	CreatedAt    time.Time
	ErrorMessage string
	AgentPID     int
	WebsocketURL string
	TtydPID      int
}

// Store is a thread-safe in-memory session store.
type Store struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewStore creates a new empty Store.
func NewStore() *Store {
	return &Store{
		sessions: make(map[string]*Session),
	}
}

// Add inserts a session into the store.
func (s *Store) Add(session *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.ID] = session
}

// Get retrieves a session by ID.
func (s *Store) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	if !ok {
		return nil, false
	}
	// Return a copy to avoid data races on the caller side.
	cp := *sess
	return &cp, true
}

// GetByName retrieves a session by name.
func (s *Store) GetByName(name string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sess := range s.sessions {
		if sess.Name == name {
			cp := *sess
			return &cp, true
		}
	}
	return nil, false
}

// List returns all sessions as copies.
func (s *Store) List() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		cp := *sess
		result = append(result, &cp)
	}
	return result
}

// Update applies a mutation function to a session identified by ID.
// Returns true if the session was found and updated.
func (s *Store) Update(id string, fn func(*Session)) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return false
	}
	fn(sess)
	return true
}

// Delete removes a session from the store.
// Returns true if the session existed and was removed.
func (s *Store) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.sessions[id]; !ok {
		return false
	}
	delete(s.sessions, id)
	return true
}

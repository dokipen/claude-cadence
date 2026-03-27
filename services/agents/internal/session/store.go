package session

import (
	"fmt"
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
	CreatedAt    time.Time
	StoppedAt    time.Time
	ErrorMessage string
	AgentPID     int
	WebsocketURL string
	WorktreePath string
	RepoURL      string
	BaseRef         string
	WaitingForInput bool
	IdleSince       *time.Time
	// restoredFromDisk marks a session loaded from persistent storage on daemon
	// startup. Ephemeral: never serialized. Used by reconcile() to avoid
	// incorrectly stopping a restored Running session whose process is alive
	// but whose PTY handle no longer exists in this daemon's lifetime.
	restoredFromDisk bool
}

// Store is a thread-safe in-memory session store.
type Store struct {
	mu        sync.RWMutex
	sessions  map[string]*Session
	persister *Persister
	names     map[string]string // name -> id secondary index
}

// NewStore creates a new empty Store without persistence.
func NewStore() *Store {
	return &Store{
		sessions: make(map[string]*Session),
		names:    make(map[string]string),
	}
}

// NewStoreWithPersister creates a new Store backed by the given Persister.
func NewStoreWithPersister(p *Persister) *Store {
	return &Store{
		sessions:  make(map[string]*Session),
		names:     make(map[string]string),
		persister: p,
	}
}

// Add inserts a session into the store.
func (s *Store) Add(session *Session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[session.ID] = session
	if session.Name != "" {
		s.names[session.Name] = session.ID
	}
	if s.persister != nil {
		s.persister.queue(*session)
	}
}

// TryAdd inserts a session into the store, enforcing an optional cap and
// an optional name-uniqueness constraint.
//
// Name uniqueness: if session.Name is non-empty, TryAdd scans existing
// sessions and returns ErrAlreadyExists if any session has the same name.
// When session.Name is empty the uniqueness check is skipped — this is
// intentional, to remain compatible with tests and legacy callers that do
// not supply a name. Any caller that expects name-uniqueness enforcement
// must provide a non-empty Name.
//
// Cap enforcement: if maxSessions > 0 and the store already contains
// maxSessions entries, TryAdd returns ErrResourceExhausted without
// inserting the session.
//
// Both the check and the insert are performed under a single write lock to
// prevent TOCTOU races under concurrent creates.
func (s *Store) TryAdd(session *Session, maxSessions int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if session.Name != "" {
		if _, exists := s.names[session.Name]; exists {
			return &Error{Code: ErrAlreadyExists, Message: "session name already exists"}
		}
	}
	if maxSessions > 0 && len(s.sessions) >= maxSessions {
		return &Error{Code: ErrResourceExhausted, Message: "max sessions reached"}
	}
	s.sessions[session.ID] = session
	if session.Name != "" {
		s.names[session.Name] = session.ID
	}
	return nil
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
	id, ok := s.names[name]
	if !ok {
		return nil, false
	}
	sess, ok := s.sessions[id]
	if !ok {
		return nil, false
	}
	cp := *sess
	return &cp, true
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
// Returns (true, nil) if the session was found and updated.
// Returns (false, nil) if the session was not found.
// Returns (false, error) if the mutation would rename the session to a name
// already held by a different session; in that case all mutations from fn are
// rolled back (full snapshot restore).
func (s *Store) Update(id string, fn func(*Session)) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return false, nil
	}
	snapshot := *sess
	fn(sess)
	// Sync name index if the name changed.
	if sess.Name != snapshot.Name {
		// Guard against collisions: if the new name is already held by a
		// different session, roll back all mutations and return an error.
		if existingID, exists := s.names[sess.Name]; exists && existingID != id {
			newName := sess.Name
			*sess = snapshot // full rollback
			return false, &Error{Code: ErrAlreadyExists, Message: fmt.Sprintf("session name %q is already in use", newName)}
		}
		if snapshot.Name != "" {
			delete(s.names, snapshot.Name)
		}
		if sess.Name != "" {
			s.names[sess.Name] = id
		}
	}
	if s.persister != nil {
		s.persister.queue(*sess)
	}
	return true, nil
}

// Delete removes a session from the store.
// Returns true if the session existed and was removed.
func (s *Store) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return false
	}
	if sess.Name != "" {
		delete(s.names, sess.Name)
	}
	delete(s.sessions, id)
	if s.persister != nil {
		s.persister.queueDelete(id)
	}
	return true
}

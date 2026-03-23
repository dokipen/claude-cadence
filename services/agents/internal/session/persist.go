package session

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// uuidRe matches the canonical UUID format produced by github.com/google/uuid.
// Session files whose ID does not match this pattern are rejected during LoadAll
// to prevent path-traversal attacks if someone writes a crafted JSON file with a
// malicious "id" field (e.g. "../../etc/passwd") into the session directory.
var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// writeOp is a discriminated union for save and delete operations.
type writeOp struct {
	del     bool    // if true, this is a delete op
	session Session // used for saves (when del is false)
	id      string  // used for deletes (when del is true)
}

// sessionRecord is the private JSON representation of a Session.
// Ephemeral fields (WaitingForInput, IdleSince) are intentionally excluded.
type sessionRecord struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	AgentProfile string       `json:"agent_profile"`
	State        SessionState `json:"state"`
	CreatedAt    time.Time    `json:"created_at"`
	StoppedAt    time.Time    `json:"stopped_at"`
	ErrorMessage string       `json:"error_message,omitempty"`
	AgentPID     int          `json:"agent_pid,omitempty"`
	WebsocketURL string       `json:"websocket_url,omitempty"`
	WorktreePath string       `json:"worktree_path,omitempty"`
	RepoURL      string       `json:"repo_url,omitempty"`
	BaseRef      string       `json:"base_ref,omitempty"`
}

func sessionToRecord(s Session) sessionRecord {
	return sessionRecord{
		ID:           s.ID,
		Name:         s.Name,
		AgentProfile: s.AgentProfile,
		State:        s.State,
		CreatedAt:    s.CreatedAt,
		StoppedAt:    s.StoppedAt,
		ErrorMessage: s.ErrorMessage,
		AgentPID:     s.AgentPID,
		WebsocketURL: s.WebsocketURL,
		WorktreePath: s.WorktreePath,
		RepoURL:      s.RepoURL,
		BaseRef:      s.BaseRef,
	}
}

func recordToSession(r sessionRecord) *Session {
	return &Session{
		ID:           r.ID,
		Name:         r.Name,
		AgentProfile: r.AgentProfile,
		State:        r.State,
		CreatedAt:    r.CreatedAt,
		StoppedAt:    r.StoppedAt,
		ErrorMessage: r.ErrorMessage,
		AgentPID:     r.AgentPID,
		WebsocketURL: r.WebsocketURL,
		WorktreePath: r.WorktreePath,
		RepoURL:      r.RepoURL,
		BaseRef:      r.BaseRef,
	}
}

// Persister provides write-behind persistence for sessions to a directory.
// Saves and deletes are serialized through a buffered channel to a background
// goroutine, preserving ordering without blocking callers.
type Persister struct {
	dir  string
	ch   chan writeOp
	done chan struct{}
}

const persistChanBuffer = 256

// NewPersister creates the storage directory and starts the background write
// goroutine. Returns an error if the directory cannot be created.
func NewPersister(dir string) (*Persister, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	p := &Persister{
		dir:  dir,
		ch:   make(chan writeOp, persistChanBuffer),
		done: make(chan struct{}),
	}
	go p.writeLoop()
	return p, nil
}

// queue enqueues a save operation. Non-blocking: drops with an error log if full.
// A dropped save means the session's on-disk state diverges from memory until the
// next state change; operators should alert on this log line.
func (p *Persister) queue(s Session) {
	op := writeOp{session: s}
	select {
	case p.ch <- op:
	default:
		slog.Error("persist: write channel full, dropping save — on-disk state may diverge", "session_id", s.ID)
	}
}

// queueDelete enqueues a delete operation. Non-blocking: drops with an error log if full.
func (p *Persister) queueDelete(id string) {
	op := writeOp{del: true, id: id}
	select {
	case p.ch <- op:
	default:
		slog.Error("persist: write channel full, dropping delete — stale file may remain on disk", "session_id", id)
	}
}

// Stop closes the write channel and waits for the goroutine to drain and exit.
func (p *Persister) Stop() {
	close(p.ch)
	<-p.done
}

// writeLoop drains the channel and performs disk operations until the channel
// is closed and drained.
func (p *Persister) writeLoop() {
	defer close(p.done)
	for op := range p.ch {
		if op.del {
			p.deleteFile(op.id)
		} else {
			p.saveFile(op.session)
		}
	}
}

func (p *Persister) saveFile(s Session) {
	rec := sessionToRecord(s)
	data, err := json.Marshal(rec)
	if err != nil {
		slog.Warn("persist: failed to marshal session", "session_id", s.ID, "error", err)
		return
	}

	tmpPath := filepath.Join(p.dir, s.ID+".json.tmp")
	finalPath := filepath.Join(p.dir, s.ID+".json")

	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		slog.Warn("persist: failed to write tmp file", "session_id", s.ID, "error", err)
		return
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		slog.Warn("persist: failed to rename tmp file", "session_id", s.ID, "path", tmpPath, "error", err)
		// Best-effort cleanup of orphaned tmp file.
		if rmErr := os.Remove(tmpPath); rmErr != nil && !os.IsNotExist(rmErr) {
			slog.Warn("persist: failed to remove orphaned tmp file", "path", tmpPath, "error", rmErr)
		}
	}
}

func (p *Persister) deleteFile(id string) {
	path := filepath.Join(p.dir, id+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		slog.Warn("persist: failed to delete session file", "session_id", id, "error", err)
	}
}

// LoadAll reads all *.json files from the directory and returns their sessions.
// Corrupt or unreadable files are skipped with a warning. If the directory does
// not exist, returns nil, nil.
func (p *Persister) LoadAll() ([]*Session, error) {
	entries, err := os.ReadDir(p.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var sessions []*Session
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".json.tmp") {
			continue
		}
		path := filepath.Join(p.dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("persist: failed to read session file, skipping", "file", name, "error", err)
			continue
		}
		var rec sessionRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			slog.Warn("persist: failed to unmarshal session file, skipping", "file", name, "error", err)
			continue
		}
		// Reject non-UUID IDs to prevent path traversal: a crafted file with
		// "id": "../../etc/passwd" would otherwise let deleteFile escape p.dir.
		if !uuidRe.MatchString(rec.ID) {
			slog.Warn("persist: session file has non-UUID id, skipping", "file", name, "id", rec.ID)
			continue
		}
		sessions = append(sessions, recordToSession(rec))
	}
	return sessions, nil
}

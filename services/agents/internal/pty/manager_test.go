package pty

import (
	"os"
	"strings"
	"testing"
	"time"
)

// pollBuffer polls ReadBuffer until the output contains want or the deadline passes.
func pollBuffer(t *testing.T, m *PTYManager, id, want string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		buf, err := m.ReadBuffer(id)
		if err != nil {
			t.Fatalf("ReadBuffer failed: %v", err)
		}
		if strings.Contains(string(buf), want) {
			return string(buf)
		}
		time.Sleep(10 * time.Millisecond)
	}
	buf, _ := m.ReadBuffer(id)
	t.Fatalf("timed out waiting for %q in buffer; got: %q", want, string(buf))
	return ""
}

func TestPTYManager_CreateAndDestroy(t *testing.T) {
	m := NewPTYManager(PTYConfig{})

	err := m.Create("sess1", t.TempDir(), []string{"echo", "hello"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	pollBuffer(t, m, "sess1", "hello")

	err = m.Destroy("sess1")
	if err != nil {
		t.Fatalf("Destroy failed: %v", err)
	}

	// Session should be gone.
	_, err = m.Get("sess1")
	if err == nil {
		t.Error("expected error after Destroy, got nil")
	}
}

func TestPTYManager_DuplicateCreate(t *testing.T) {
	m := NewPTYManager(PTYConfig{})
	err := m.Create("dup", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("first Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("dup") })

	err = m.Create("dup", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err == nil {
		t.Error("expected error on duplicate Create, got nil")
	}
}

func TestPTYManager_DestroyNotFound(t *testing.T) {
	m := NewPTYManager(PTYConfig{})
	err := m.Destroy("nonexistent")
	if err == nil {
		t.Error("expected error when destroying nonexistent session")
	}
}

func TestPTYManager_PID(t *testing.T) {
	m := NewPTYManager(PTYConfig{})
	err := m.Create("pidtest", t.TempDir(), []string{"sleep", "5"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("pidtest") })

	pid, err := m.PID("pidtest")
	if err != nil {
		t.Fatalf("PID failed: %v", err)
	}
	if pid <= 0 {
		t.Errorf("expected positive PID, got %d", pid)
	}
}

func TestPTYManager_EmptyCommand(t *testing.T) {
	m := NewPTYManager(PTYConfig{})
	err := m.Create("empty", t.TempDir(), []string{}, nil, 80, 24)
	if err == nil {
		t.Error("expected error for empty command")
	}
}

func TestPTYManager_DefaultWindowSize(t *testing.T) {
	m := NewPTYManager(PTYConfig{})
	// cols=0, rows=0 should default to 80x24
	err := m.Create("defsize", t.TempDir(), []string{"sleep", "1"}, nil, 0, 0)
	if err != nil {
		t.Fatalf("Create with zero window size failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("defsize") })
}

func TestPTYManager_MaxSessions_Enforced(t *testing.T) {
	m := NewPTYManager(PTYConfig{MaxSessions: 2})

	err := m.Create("cap1", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create cap1 failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("cap1") })

	err = m.Create("cap2", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create cap2 failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("cap2") })

	err = m.Create("cap3", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err == nil {
		t.Cleanup(func() { m.Destroy("cap3") })
		t.Fatal("expected error on 3rd Create when MaxSessions=2, got nil")
	}
	if !strings.Contains(err.Error(), "max sessions") {
		t.Errorf("expected error containing \"max sessions\", got: %v", err)
	}
}

func TestPTYManager_MaxSessions_Zero_Unlimited(t *testing.T) {
	m := NewPTYManager(PTYConfig{MaxSessions: 0})

	for i, id := range []string{"unlim1", "unlim2", "unlim3"} {
		err := m.Create(id, t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
		if err != nil {
			t.Fatalf("Create session %d (%s) failed: %v", i+1, id, err)
		}
		id := id
		t.Cleanup(func() { m.Destroy(id) })
	}
}

func TestPTYManager_MaxSessions_SlotFreedAfterDestroy(t *testing.T) {
	m := NewPTYManager(PTYConfig{MaxSessions: 2})

	err := m.Create("slot1", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create slot1 failed: %v", err)
	}
	t.Cleanup(func() { m.Destroy("slot1") })

	err = m.Create("slot2", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create slot2 failed: %v", err)
	}

	// Destroy slot2 to free a slot.
	if err = m.Destroy("slot2"); err != nil {
		t.Fatalf("Destroy slot2 failed: %v", err)
	}

	// Now slot3 should succeed because a slot was freed.
	err = m.Create("slot3", t.TempDir(), []string{"sleep", "10"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create slot3 after Destroy expected to succeed, got: %v", err)
	}
	t.Cleanup(func() { m.Destroy("slot3") })
}

func TestMaxResizeDimension(t *testing.T) {
	if maxResizeDimension != 500 {
		t.Errorf("expected maxResizeDimension=500, got %d", maxResizeDimension)
	}
}

// TestSession_closeMaster_idempotent verifies that closeMaster is safe to call
// multiple times. Without sync.Once, the second close of a recycled fd would
// silently close an unrelated file descriptor opened between the two closes —
// the classic double-close fd-reuse hazard described in issue #408.
func TestSession_closeMaster_idempotent(t *testing.T) {
	f, err := os.CreateTemp(t.TempDir(), "pty-master-test-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}

	sess := &session{master: f}

	// First close — reclaims the fd number.
	sess.closeMaster()

	// Open a new file; the OS may reuse the same fd number.
	f2, err := os.CreateTemp(t.TempDir(), "pty-master-recycled-*")
	if err != nil {
		t.Fatalf("CreateTemp: %v", err)
	}
	defer f2.Close()

	// Second closeMaster must be a no-op — it must not close f2.
	sess.closeMaster()

	// Verify f2 is still usable (would fail with EIO/EBADF if fd was closed).
	if _, err := f2.Write([]byte("ok")); err != nil {
		t.Fatalf("recycled fd was closed by second closeMaster call: %v", err)
	}
}

// TestDefaultBufferSize_FitsWithFramePrefix verifies that a full ring buffer
// replay frame (1-byte ttyd type prefix + buffer contents) does not exceed the
// hub proxy's MaxMessageSize (1 << 20). This guards against the off-by-one
// that caused #344: terminal connections dropped when the buffer was full.
func TestDefaultBufferSize_FitsWithFramePrefix(t *testing.T) {
	const maxMessageSize = 1 << 20 // must match hub.MaxMessageSize
	const framePrefixLen = 1       // ttyd type byte ('0')
	frameSize := framePrefixLen + defaultBufferSize
	if frameSize > maxMessageSize {
		t.Errorf("full replay frame (%d bytes) exceeds MaxMessageSize (%d); "+
			"defaultBufferSize must be at most %d",
			frameSize, maxMessageSize, maxMessageSize-framePrefixLen)
	}
}

package pty

import (
	"strings"
	"testing"
	"time"
)

func TestPTYManager_CreateAndDestroy(t *testing.T) {
	m := NewPTYManager(PTYConfig{})

	err := m.Create("sess1", t.TempDir(), []string{"echo", "hello"}, nil, 80, 24)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	// Wait briefly for the echo to complete and output to be buffered.
	time.Sleep(100 * time.Millisecond)

	buf, err := m.ReadBuffer("sess1")
	if err != nil {
		t.Fatalf("ReadBuffer failed: %v", err)
	}
	if !strings.Contains(string(buf), "hello") {
		t.Errorf("expected output to contain %q, got %q", "hello", string(buf))
	}

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

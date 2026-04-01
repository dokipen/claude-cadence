//go:build darwin || linux

package pty

import (
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestMasterSlavePath(t *testing.T) {
	// Open a real PTY pair.
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open: %v", err)
	}
	defer master.Close()
	defer slave.Close()

	got := masterSlavePath(master)
	if got == "" {
		t.Fatal("masterSlavePath returned empty string")
	}

	switch runtime.GOOS {
	case "linux":
		if !validSlavePath.MatchString(got) {
			t.Errorf("masterSlavePath returned %q, want /dev/pts/N", got)
		}
	case "darwin":
		if !validSlavePath.MatchString(got) {
			t.Errorf("masterSlavePath returned %q, want /dev/ttysNNN", got)
		}
	}

	// Verify the slave path actually exists as a device.
	info, err := os.Stat(got)
	if err != nil {
		t.Fatalf("os.Stat(%q): %v", got, err)
	}
	// PTY devices have mode bits indicating a character device.
	if info.Mode()&os.ModeCharDevice == 0 {
		t.Errorf("%q is not a character device", got)
	}
}

func TestMasterSlavePath_InvalidFd(t *testing.T) {
	// A regular file should fail the ioctl gracefully.
	f, err := os.CreateTemp(t.TempDir(), "not-a-pty")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	got := masterSlavePath(f)
	if got != "" {
		t.Errorf("masterSlavePath on regular file returned %q, want empty string", got)
	}
}

// TestReattach_StalePTY verifies that Reattach does not block when the PTY
// master is already closed (the core bug: open(2) on a slave with no master
// blocks indefinitely without O_NONBLOCK).
//
// Platform behavior differs:
//   - macOS: the slave device node (/dev/ttysN) persists after master close;
//     open(2) without O_NONBLOCK blocks forever; with O_NONBLOCK returns ENXIO.
//   - Linux: closing the master removes the /dev/pts/N device node entirely,
//     so open(2) returns ENOENT immediately regardless of O_NONBLOCK. The test
//     still validates the fast-fail contract; the O_NONBLOCK fix is the
//     load-bearing guard on macOS where the hang would otherwise occur.
func TestReattach_StalePTY(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open: %v", err)
	}
	slavePath := masterSlavePath(master)
	if slavePath == "" {
		master.Close()
		slave.Close()
		t.Skip("could not determine slave path")
	}
	slave.Close()
	master.Close() // close master so the slave device has no master — Reattach must not block

	m := NewPTYManager(PTYConfig{})
	done := make(chan error, 1)
	go func() {
		done <- m.Reattach("stale-pty", slavePath)
	}()

	select {
	case reattachErr := <-done:
		// Expected: Reattach returns an error quickly (slave open fails with no master).
		if reattachErr == nil {
			t.Error("expected Reattach to fail on a stale PTY, got nil error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Reattach blocked for >5s on a stale PTY slave — O_NONBLOCK fix not applied")
	}
}

// TestReattach_LivePTY verifies that Reattach succeeds and can read output
// when the PTY master is still open.
func TestReattach_LivePTY(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatalf("pty.Open: %v", err)
	}
	defer master.Close()
	defer slave.Close()

	slavePath := masterSlavePath(master)
	if slavePath == "" {
		t.Skip("could not determine slave path")
	}

	m := NewPTYManager(PTYConfig{})
	if err := m.Reattach("live-pty", slavePath); err != nil {
		t.Fatalf("Reattach failed on live PTY: %v", err)
	}
	t.Cleanup(func() { m.Destroy("live-pty") })

	// Write to master; the reattached session's read goroutine should buffer it.
	if _, err := master.Write([]byte("hello\n")); err != nil {
		t.Fatalf("master.Write: %v", err)
	}

	pollBuffer(t, m, "live-pty", "hello")
}

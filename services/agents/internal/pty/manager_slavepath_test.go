//go:build darwin || linux

package pty

import (
	"os"
	"runtime"
	"testing"

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

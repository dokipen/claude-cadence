//go:build darwin

package pty

import (
	"os"
	"regexp"
)

// validSlavePath matches macOS PTY slave device paths (e.g. /dev/ttys000).
// masterSlavePath always returns "" on macOS so Reattach will never be
// called with a non-empty path; this pattern exists to satisfy the build
// and to validate any future macOS Reattach implementation.
var validSlavePath = regexp.MustCompile(`^/dev/ttys[0-9]+$`)

// masterSlavePath returns the slave PTY path for the given master file.
// Slave path recovery via ioctl is not implemented on macOS; returns empty
// string. PTY reattach after daemon restart is not supported on macOS.
func masterSlavePath(_ *os.File) string {
	return ""
}

//go:build !linux && !darwin

package pty

import (
	"os"
	"regexp"
)

// validSlavePath matches PTY slave device paths on unsupported platforms.
// Reattach is not implemented on platforms other than Linux and macOS.
var validSlavePath = regexp.MustCompile(`^$`) // never matches — Reattach not supported

// clearNonblock is a no-op on unsupported platforms. Reattach always returns
// early on these platforms because validSlavePath never matches.
func clearNonblock(_ *os.File) error {
	return nil
}

// masterSlavePath returns the slave PTY path for the given master file.
// Not implemented on platforms other than Linux and macOS.
func masterSlavePath(_ *os.File) string {
	return ""
}

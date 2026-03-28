//go:build linux

package pty

import (
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"syscall"
	"unsafe"
)

// validSlavePath matches Linux PTY slave device paths (e.g. /dev/pts/0).
var validSlavePath = regexp.MustCompile(`^/dev/pts/[0-9]+$`)

// masterSlavePath returns the /dev/pts/N path of the slave side of the PTY
// for the given master file. Uses TIOCGPTN ioctl. Returns an empty string
// if the path cannot be determined.
func masterSlavePath(master *os.File) string {
	var n uint32
	// TIOCGPTN is the Linux ioctl to get the PTY number from the master fd.
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCGPTN, uintptr(unsafe.Pointer(&n))); errno != 0 { //nolint:gosec // Expected unsafe pointer for Syscall call.
		slog.Warn("pty: failed to get slave path via TIOCGPTN", "error", errno)
		return ""
	}
	return "/dev/pts/" + strconv.FormatUint(uint64(n), 10)
}

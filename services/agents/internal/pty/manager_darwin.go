//go:build darwin

package pty

import (
	"log/slog"
	"os"
	"regexp"
	"strings"
	"syscall"
	"unsafe"
)

// validSlavePath matches macOS PTY slave device paths (e.g. /dev/ttys000).
var validSlavePath = regexp.MustCompile(`^/dev/ttys[0-9]+$`)

// _TIOCPTYGNAME is the macOS ioctl to retrieve the slave PTY device name
// from a master fd. Defined in <sys/ttycom.h> as _IOC(IOC_OUT, 't', 83, 128).
const _TIOCPTYGNAME = 0x40807453

// masterSlavePath returns the /dev/ttysNNN path of the slave side of the PTY
// for the given master file. Uses TIOCPTYGNAME ioctl. Returns an empty string
// if the path cannot be determined.
func masterSlavePath(master *os.File) string {
	var buf [128]byte
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), _TIOCPTYGNAME, uintptr(unsafe.Pointer(&buf[0]))); errno != 0 { //nolint:gosec // Expected unsafe pointer for Syscall call.
		slog.Warn("pty: failed to get slave path via TIOCPTYGNAME", "error", errno)
		return ""
	}
	// buf is a NUL-terminated C string; trim at first NUL byte.
	name := string(buf[:])
	if i := strings.IndexByte(name, 0); i >= 0 {
		name = name[:i]
	}
	return name
}

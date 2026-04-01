//go:build darwin

package pty

import (
	"bytes"
	"log/slog"
	"os"
	"regexp"
	"runtime"
	"syscall"
	"unsafe"
)

// validSlavePath matches macOS PTY slave device paths (e.g. /dev/ttys000).
var validSlavePath = regexp.MustCompile(`^/dev/ttys[0-9]+$`)

// _TIOCPTYGNAME is the macOS ioctl to retrieve the slave PTY device name
// from a master fd. Defined in <sys/ttycom.h> as _IOC(IOC_OUT, 't', 83, 128).
const _TIOCPTYGNAME = 0x40807453

// clearNonblock clears the O_NONBLOCK flag on f using fcntl(F_GETFL/F_SETFL).
// Called by Reattach after a successful O_NONBLOCK open so that subsequent
// reads on the slave device block normally.
func clearNonblock(f *os.File) error {
	rawConn, err := f.SyscallConn()
	if err != nil {
		return err
	}
	var fcntlErr error
	if controlErr := rawConn.Control(func(fd uintptr) {
		flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, fd, syscall.F_GETFL, 0)
		if errno != 0 {
			fcntlErr = errno
			return
		}
		_, _, errno = syscall.Syscall(syscall.SYS_FCNTL, fd, syscall.F_SETFL, flags&^uintptr(syscall.O_NONBLOCK))
		if errno != 0 {
			fcntlErr = errno
		}
	}); controlErr != nil {
		return controlErr
	}
	return fcntlErr
}

// masterSlavePath returns the /dev/ttysNNN path of the slave side of the PTY
// for the given master file. Uses TIOCPTYGNAME ioctl. Returns an empty string
// if the path cannot be determined.
func masterSlavePath(master *os.File) string {
	var buf [128]byte
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), _TIOCPTYGNAME, uintptr(unsafe.Pointer(&buf[0]))) //nolint:gosec // Expected unsafe pointer for Syscall call.
	runtime.KeepAlive(master)                                                                                        // prevent GC from finalizing master (closing fd) before Syscall completes
	if errno != 0 {
		slog.Warn("pty: failed to get slave path via TIOCPTYGNAME", "error", errno)
		return ""
	}
	// buf is a NUL-terminated C string; trim at first NUL byte.
	if i := bytes.IndexByte(buf[:], 0); i >= 0 {
		return string(buf[:i])
	}
	return ""
}

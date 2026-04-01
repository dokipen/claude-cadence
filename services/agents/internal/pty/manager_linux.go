//go:build linux

package pty

import (
	"log/slog"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"syscall"
	"unsafe"
)

// validSlavePath matches Linux PTY slave device paths (e.g. /dev/pts/0).
var validSlavePath = regexp.MustCompile(`^/dev/pts/[0-9]+$`)

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

// masterSlavePath returns the /dev/pts/N path of the slave side of the PTY
// for the given master file. Uses TIOCGPTN ioctl. Returns an empty string
// if the path cannot be determined.
func masterSlavePath(master *os.File) string {
	var n uint32
	// TIOCGPTN is the Linux ioctl to get the PTY number from the master fd.
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, master.Fd(), syscall.TIOCGPTN, uintptr(unsafe.Pointer(&n))) //nolint:gosec // Expected unsafe pointer for Syscall call.
	runtime.KeepAlive(master)                                                                                      // prevent GC from finalizing master (closing fd) before Syscall completes
	if errno != 0 {
		slog.Warn("pty: failed to get slave path via TIOCGPTN", "error", errno)
		return ""
	}
	return "/dev/pts/" + strconv.FormatUint(uint64(n), 10)
}

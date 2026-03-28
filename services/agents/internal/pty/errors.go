package pty

import "errors"

// ErrSessionNotFound is returned by PTYManager methods when the requested session ID does not exist.
var ErrSessionNotFound = errors.New("pty: session not found")

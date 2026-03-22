package pty

import "sync"

// RingBuffer is a fixed-size circular byte buffer.
// Concurrency: Write is called only from the PTY read goroutine (single writer).
// Snapshot is called from multiple goroutines concurrently.
// A sync.Mutex guards all access.
type RingBuffer struct {
	buf  []byte
	head int // write position (next byte to overwrite)
	size int // total bytes written so far (capped at len(buf))
	mu   sync.Mutex
}

// NewRingBuffer creates a RingBuffer with the given capacity in bytes.
func NewRingBuffer(capacity int) *RingBuffer {
	return &RingBuffer{buf: make([]byte, capacity)}
}

// Write implements io.Writer. It writes p into the ring buffer, overwriting
// the oldest bytes when the buffer is full. Safe for concurrent use.
func (r *RingBuffer) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, b := range p {
		r.buf[r.head] = b
		r.head = (r.head + 1) % len(r.buf)
		if r.size < len(r.buf) {
			r.size++
		}
	}
	return len(p), nil
}

// Snapshot returns a copy of the current contents in chronological order.
func (r *RingBuffer) Snapshot() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.size == 0 {
		return nil
	}
	out := make([]byte, r.size)
	if r.size < len(r.buf) {
		// Buffer not yet full — data starts at index 0
		copy(out, r.buf[:r.size])
	} else {
		// Buffer full — oldest data starts at head
		n := copy(out, r.buf[r.head:])
		copy(out[n:], r.buf[:r.head])
	}
	return out
}

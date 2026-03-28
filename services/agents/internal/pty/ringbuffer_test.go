package pty

import (
	"bytes"
	"sync"
	"testing"
)

func TestRingBuffer_BasicWrite(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("hello"))
	snap := rb.Snapshot()
	if !bytes.Equal(snap, []byte("hello")) {
		t.Errorf("expected %q, got %q", "hello", snap)
	}
}

func TestRingBuffer_WrapAround(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("hello")) // fills buffer
	rb.Write([]byte("world")) // wraps around, overwrites "hello"
	snap := rb.Snapshot()
	if !bytes.Equal(snap, []byte("world")) {
		t.Errorf("expected %q after wrap-around, got %q", "world", snap)
	}
}

func TestRingBuffer_PartialWrap(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("abc"))   // 3 bytes
	rb.Write([]byte("de"))    // 2 bytes — fills exactly
	rb.Write([]byte("fg"))    // 2 bytes — wraps: overwrites 'a', 'b'
	snap := rb.Snapshot()
	// Buffer should contain "cdefg"
	if !bytes.Equal(snap, []byte("cdefg")) {
		t.Errorf("expected %q after partial wrap, got %q", "cdefg", snap)
	}
}

func TestRingBuffer_Empty(t *testing.T) {
	rb := NewRingBuffer(10)
	snap := rb.Snapshot()
	if snap != nil {
		t.Errorf("expected nil snapshot from empty buffer, got %v", snap)
	}
}

func TestRingBuffer_ConcurrentSnapshot(t *testing.T) {
	// Single-writer invariant: Write is called from one goroutine.
	// But Snapshot is called concurrently. Test that concurrent Snapshots
	// don't race with a single writer.
	rb := NewRingBuffer(1024)
	const iterations = 1000

	var wg sync.WaitGroup
	// Single writer goroutine.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			rb.Write([]byte("x"))
		}
	}()
	// Multiple reader goroutines.
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				snap := rb.Snapshot()
				_ = snap
			}
		}()
	}
	wg.Wait()
}

func TestRingBuffer_Snapshot_ReturnsCopy(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("hello"))
	snap := rb.Snapshot()
	snap[0] = 'X' // mutate returned copy
	snap2 := rb.Snapshot()
	if snap2[0] != 'h' {
		t.Error("Snapshot should return an independent copy")
	}
}

func TestRingBuffer_ExactCapacity(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("12345"))
	snap := rb.Snapshot()
	if !bytes.Equal(snap, []byte("12345")) {
		t.Errorf("expected %q, got %q", "12345", snap)
	}
}

func TestRingBuffer_LargerThanCapacity(t *testing.T) {
	rb := NewRingBuffer(3)
	rb.Write([]byte("abcdef")) // 6 bytes into 3-byte buffer
	snap := rb.Snapshot()
	if len(snap) != 3 {
		t.Fatalf("expected 3 bytes, got %d", len(snap))
	}
	if !bytes.Equal(snap, []byte("def")) {
		t.Errorf("expected last 3 bytes %q, got %q", "def", snap)
	}
}

func BenchmarkRingBuffer_Snapshot_1MB(b *testing.B) {
	rb := NewRingBuffer(defaultBufferSize)
	// Fill the buffer completely by writing 2 MB (ensures wrap-around).
	chunk := bytes.Repeat([]byte("x"), 4096)
	for rb.size < len(rb.buf) {
		rb.Write(chunk)
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = rb.Snapshot()
	}
}

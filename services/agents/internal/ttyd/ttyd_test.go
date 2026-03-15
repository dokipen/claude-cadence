package ttyd

import (
	"sync"
	"testing"
)

func TestPortReuse(t *testing.T) {
	c := NewClient(true, 10000, 5)

	// Simulate allocating a port without actually launching a process.
	// We test the allocation logic directly via the unexported fields.
	c.mu.Lock()
	c.procs["s1"] = &procInfo{pid: 1, port: 10000}
	c.nextPort = 10001
	c.mu.Unlock()

	// Stop should return the port to the free list.
	// We override procs so Stop won't try to kill a real process.
	c.Stop("s1")

	c.mu.Lock()
	if len(c.freePorts) != 1 || c.freePorts[0] != 10000 {
		t.Fatalf("expected port 10000 in freePorts, got %v", c.freePorts)
	}
	c.mu.Unlock()
}

func TestPortExhaustion(t *testing.T) {
	c := NewClient(true, 10000, 2)

	// Manually allocate both ports.
	c.mu.Lock()
	c.nextPort = 10002 // exhausted: basePort(10000) + maxPorts(2)
	c.procs["s1"] = &procInfo{pid: 1, port: 10000}
	c.procs["s2"] = &procInfo{pid: 2, port: 10001}
	c.mu.Unlock()

	// Start should fail with ErrPortsExhausted.
	_, err := c.Start("s3", "sock", "sess")
	if err != ErrPortsExhausted {
		t.Fatalf("expected ErrPortsExhausted, got %v", err)
	}
}

func TestPortReusedAfterExhaustion(t *testing.T) {
	c := NewClient(true, 10000, 1)

	// Exhaust the single port.
	c.mu.Lock()
	c.nextPort = 10001
	c.procs["s1"] = &procInfo{pid: 1, port: 10000}
	c.mu.Unlock()

	// Should be exhausted.
	_, err := c.Start("s2", "sock", "sess")
	if err != ErrPortsExhausted {
		t.Fatalf("expected ErrPortsExhausted, got %v", err)
	}

	// Free the port.
	c.Stop("s1")

	// Now the freed port should be available in the free list.
	c.mu.Lock()
	if len(c.freePorts) != 1 || c.freePorts[0] != 10000 {
		t.Fatalf("expected port 10000 in freePorts after stop, got %v", c.freePorts)
	}
	c.mu.Unlock()
}

func TestDisabledClientNoOps(t *testing.T) {
	c := NewClient(false, 10000, 5)

	url, err := c.Start("s1", "sock", "sess")
	if err != nil {
		t.Fatalf("disabled client should not error: %v", err)
	}
	if url != "" {
		t.Fatalf("disabled client should return empty url, got %q", url)
	}

	// Stop on disabled client should not panic.
	c.Stop("s1")
}

func TestConcurrentStartStop(t *testing.T) {
	c := NewClient(true, 20000, 100)

	// We can't actually start ttyd processes in unit tests, so we test
	// the allocation/free logic directly under concurrent access.
	var wg sync.WaitGroup
	const n = 50

	// Allocate n ports concurrently.
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c.mu.Lock()
			if c.nextPort < c.basePort+c.maxPorts {
				port := c.nextPort
				c.nextPort++
				c.procs[string(rune(port))] = &procInfo{pid: port, port: port}
			}
			c.mu.Unlock()
		}()
	}
	wg.Wait()

	c.mu.Lock()
	allocated := len(c.procs)
	c.mu.Unlock()

	if allocated != n {
		t.Fatalf("expected %d allocated, got %d", n, allocated)
	}

	// Free all ports concurrently.
	c.mu.Lock()
	keys := make([]string, 0, len(c.procs))
	for k := range c.procs {
		keys = append(keys, k)
	}
	c.mu.Unlock()

	for _, k := range keys {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			c.Stop(key)
		}(k)
	}
	wg.Wait()

	c.mu.Lock()
	freeCount := len(c.freePorts)
	procsCount := len(c.procs)
	c.mu.Unlock()

	if procsCount != 0 {
		t.Fatalf("expected 0 active procs, got %d", procsCount)
	}
	if freeCount != n {
		t.Fatalf("expected %d freed ports, got %d", n, freeCount)
	}
}

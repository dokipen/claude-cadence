package rest

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestBodyReadDeadline_FastClientSucceeds verifies that a normal POST request
// whose body arrives well within the deadline completes with HTTP 200 and that
// the handler is able to read the full body.
func TestBodyReadDeadline_FastClientSucceeds(t *testing.T) {
	const deadline = 100 * time.Millisecond

	var gotBody string
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusInternalServerError)
			return
		}
		gotBody = string(data)
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, "ok")
	})

	handler := bodyReadDeadlineMiddleware(deadline)(inner)
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	body := strings.NewReader("hello")
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/test", body)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "text/plain")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, respBody)
	}

	if gotBody != "hello" {
		t.Errorf("expected body %q, got %q", "hello", gotBody)
	}
}

// TestBodyReadDeadline_SlowBodyTriggersDeadline verifies that when a client
// dials raw TCP, sends headers, then stalls longer than the deadline before
// sending the body, the server closes the connection or returns an error.
func TestBodyReadDeadline_SlowBodyTriggersDeadline(t *testing.T) {
	const deadline = 50 * time.Millisecond
	const margin = 100 * time.Millisecond

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Attempt to read the full body — should fail when deadline fires.
		_, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read timeout", http.StatusRequestTimeout)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := bodyReadDeadlineMiddleware(deadline)(inner)
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	// Dial raw TCP to the test server.
	conn, err := net.Dial("tcp", ts.Listener.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	// Write HTTP request line and headers — declare a 5-byte body but don't
	// send it yet, so the server is blocked waiting for the body.
	headers := "POST /test HTTP/1.1\r\n" +
		"Host: " + ts.Listener.Addr().String() + "\r\n" +
		"Content-Length: 5\r\n" +
		"Content-Type: text/plain\r\n" +
		"Connection: close\r\n" +
		"\r\n"
	if _, err := fmt.Fprint(conn, headers); err != nil {
		t.Fatalf("write headers: %v", err)
	}

	// Sleep longer than the deadline so the server's read deadline fires.
	time.Sleep(deadline + margin)

	// Try to write the body — the connection may already be dead.
	_, _ = fmt.Fprint(conn, "hello")

	// Set a read deadline on our end so we don't hang forever.
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))

	// Read whatever the server sent back (may be an error response or EOF).
	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')

	if err != nil && err != io.EOF {
		// Connection was closed by server — that is the expected outcome when the
		// read deadline fires mid-read (the server closes the underlying conn).
		t.Logf("connection closed by server (expected): %v", err)
		return
	}

	// If we got a response line, it must NOT be a 200.
	if strings.Contains(line, "200") {
		t.Errorf("expected non-200 response or closed connection after deadline, got: %q", line)
	}

	t.Logf("server response line: %q", line)
}

// TestBodyReadDeadline_RecorderGracefulDegradation verifies that
// bodyReadDeadlineMiddleware does not panic when the underlying ResponseWriter
// (httptest.NewRecorder) does not implement SetReadDeadline. It also verifies
// that the inner handler is still called (graceful degradation).
func TestBodyReadDeadline_RecorderGracefulDegradation(t *testing.T) {
	const deadline = 50 * time.Millisecond

	handlerCalled := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	})

	handler := bodyReadDeadlineMiddleware(deadline)(inner)

	req := httptest.NewRequest(http.MethodPost, "/test", strings.NewReader("body"))
	rec := httptest.NewRecorder()

	// Must not panic even though httptest.ResponseRecorder does not support
	// SetReadDeadline.
	handler.ServeHTTP(rec, req)

	if !handlerCalled {
		t.Error("expected inner handler to be called, but it was not")
	}

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

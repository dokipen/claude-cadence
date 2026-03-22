package hub

import (
	"bytes"
	"testing"

	"github.com/google/uuid"
)

func TestEncodeDecodeTerminalFrame_RoundTrip(t *testing.T) {
	sessionID := uuid.MustParse("12345678-1234-1234-1234-123456789abc")
	payload := []byte("hello from PTY")

	frame := EncodeTerminalFrame(sessionID, payload)

	gotID, gotPayload, err := DecodeTerminalFrame(frame)
	if err != nil {
		t.Fatalf("DecodeTerminalFrame: unexpected error: %v", err)
	}
	if gotID != sessionID {
		t.Errorf("session ID mismatch: got %v, want %v", gotID, sessionID)
	}
	if !bytes.Equal(gotPayload, payload) {
		t.Errorf("payload mismatch: got %q, want %q", gotPayload, payload)
	}
}

func TestEncodeDecodeTerminalFrame_EmptyPayload(t *testing.T) {
	sessionID := uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	payload := []byte{}

	frame := EncodeTerminalFrame(sessionID, payload)

	gotID, gotPayload, err := DecodeTerminalFrame(frame)
	if err != nil {
		t.Fatalf("DecodeTerminalFrame: unexpected error: %v", err)
	}
	if gotID != sessionID {
		t.Errorf("session ID mismatch: got %v, want %v", gotID, sessionID)
	}
	if len(gotPayload) != 0 {
		t.Errorf("expected empty payload, got %q", gotPayload)
	}
}

func TestDecodeTerminalFrame_TooShort(t *testing.T) {
	// Frame shorter than 17 bytes must return an error.
	short := make([]byte, terminalFrameHeaderLen-1)
	short[0] = FrameTypeTerminal

	_, _, err := DecodeTerminalFrame(short)
	if err == nil {
		t.Fatal("expected error for frame shorter than 17 bytes, got nil")
	}
}

func TestDecodeTerminalFrame_WrongTypeByte(t *testing.T) {
	// Build a valid-length frame but with a wrong type byte.
	frame := make([]byte, terminalFrameHeaderLen+4)
	frame[0] = 0x02 // wrong type
	id := uuid.New(); copy(frame[1:17], id[:])
	copy(frame[17:], []byte("data"))

	_, _, err := DecodeTerminalFrame(frame)
	if err == nil {
		t.Fatal("expected error for wrong type byte, got nil")
	}
}

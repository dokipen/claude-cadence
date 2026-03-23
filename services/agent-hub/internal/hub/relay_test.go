package hub

import (
	"bytes"
	"testing"

	"github.com/google/uuid"

	sharedrelay "github.com/dokipen/claude-cadence/services/shared/relay"
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
	short := make([]byte, sharedrelay.TerminalFrameHeaderLen-1)
	short[0] = sharedrelay.FrameTypeTerminal

	_, _, err := DecodeTerminalFrame(short)
	if err == nil {
		t.Fatal("expected error for frame shorter than 17 bytes, got nil")
	}
}

func TestDecodeTerminalFrame_WrongTypeByte(t *testing.T) {
	// Build a valid-length frame but with a wrong type byte.
	frame := make([]byte, sharedrelay.TerminalFrameHeaderLen+4)
	frame[0] = 0x02 // wrong type
	id := uuid.New(); copy(frame[1:17], id[:])
	copy(frame[17:], []byte("data"))

	_, _, err := DecodeTerminalFrame(frame)
	if err == nil {
		t.Fatal("expected error for wrong type byte, got nil")
	}
}

func TestDecodeRelayEndFrame_HappyPath(t *testing.T) {
	sessionID := uuid.MustParse("12345678-1234-1234-1234-123456789abc")

	// Build a valid relay-end frame: [0x02][16-byte UUID].
	frame := make([]byte, sharedrelay.TerminalFrameHeaderLen)
	frame[0] = sharedrelay.FrameTypeRelayEnd
	copy(frame[1:17], sessionID[:])

	gotID, err := DecodeRelayEndFrame(frame)
	if err != nil {
		t.Fatalf("DecodeRelayEndFrame: unexpected error: %v", err)
	}
	if gotID != sessionID {
		t.Errorf("session ID mismatch: got %v, want %v", gotID, sessionID)
	}
}

func TestDecodeRelayEndFrame_TooShort(t *testing.T) {
	short := make([]byte, sharedrelay.TerminalFrameHeaderLen-1)
	short[0] = sharedrelay.FrameTypeRelayEnd

	_, err := DecodeRelayEndFrame(short)
	if err == nil {
		t.Fatal("expected error for frame shorter than 17 bytes, got nil")
	}
}

func TestDecodeRelayEndFrame_WrongTypeByte(t *testing.T) {
	// Build a valid-length frame but with the terminal type byte instead of relay-end.
	frame := make([]byte, sharedrelay.TerminalFrameHeaderLen)
	frame[0] = sharedrelay.FrameTypeTerminal
	id := uuid.New()
	copy(frame[1:17], id[:])

	_, err := DecodeRelayEndFrame(frame)
	if err == nil {
		t.Fatal("expected error for wrong type byte (FrameTypeTerminal), got nil")
	}
}

package hub

import (
	"fmt"

	"github.com/google/uuid"
)

const (
	// FrameTypeTerminal identifies a terminal relay binary frame.
	FrameTypeTerminal byte = 0x01
	// terminalFrameHeaderLen is 1 (type) + 16 (UUID bytes).
	terminalFrameHeaderLen = 17
)

// EncodeTerminalFrame encodes a terminal data frame as:
//
//	[1-byte type=0x01][16-byte session UUID][payload]
func EncodeTerminalFrame(sessionID uuid.UUID, payload []byte) []byte {
	frame := make([]byte, terminalFrameHeaderLen+len(payload))
	frame[0] = FrameTypeTerminal
	copy(frame[1:17], sessionID[:])
	copy(frame[17:], payload)
	return frame
}

// DecodeTerminalFrame decodes a binary frame. Returns the session UUID and
// payload, or an error if the frame is malformed.
func DecodeTerminalFrame(frame []byte) (sessionID uuid.UUID, payload []byte, err error) {
	if len(frame) < terminalFrameHeaderLen {
		return uuid.UUID{}, nil, fmt.Errorf("terminal frame too short: %d bytes", len(frame))
	}
	if frame[0] != FrameTypeTerminal {
		return uuid.UUID{}, nil, fmt.Errorf("unexpected frame type: 0x%02x", frame[0])
	}
	copy(sessionID[:], frame[1:17])
	return sessionID, frame[17:], nil
}

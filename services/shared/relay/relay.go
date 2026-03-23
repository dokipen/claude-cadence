// Package relay defines shared constants for the terminal relay binary protocol
// used between the agent service and agent-hub.
package relay

const (
	// FrameTypeTerminal identifies a terminal relay binary frame.
	FrameTypeTerminal byte = 0x01
	// TerminalFrameHeaderLen is 1 (type byte) + 16 (UUID bytes).
	TerminalFrameHeaderLen = 17
)

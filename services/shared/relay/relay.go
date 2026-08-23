// Package relay defines shared constants for the terminal relay binary protocol
// used between the agent service and agent-hub.
package relay

const (
	// FrameTypeTerminal identifies a terminal relay binary frame.
	FrameTypeTerminal byte = 0x01
	// FrameTypeRelayEnd identifies a relay-end notification frame sent when a
	// PTY session exits, signalling the hub to close its relay channel.
	FrameTypeRelayEnd byte = 0x02
	// TerminalFrameHeaderLen is 1 (type byte) + 16 (UUID bytes).
	TerminalFrameHeaderLen = 17

	// TtydFramePrefixLen is the 1-byte ttyd server→client frame type prefix
	// ('0' for output) that precedes raw terminal bytes inside a terminal
	// relay payload.
	TtydFramePrefixLen = 1

	// MaxPTYBufferSize is the largest PTY ring buffer agentd accepts
	// (pty.buffer_size). It is also the default ring buffer capacity.
	MaxPTYBufferSize = 1<<20 - 1

	// MaxSnapshotFrameSize is the largest terminal relay frame agentd can emit:
	// a full ring-buffer snapshot replay wrapped in the ttyd prefix and the
	// relay header. The hub's agent-connection read limit MUST exceed this
	// value, otherwise a single snapshot replay closes the whole agent
	// connection (see issue #685).
	MaxSnapshotFrameSize = MaxPTYBufferSize + TtydFramePrefixLen + TerminalFrameHeaderLen

	// AgentMaxMessageSize is the hub's read limit for a single WebSocket
	// message on the agent connection (both JSON-RPC text frames and binary
	// relay frames). It is a bug backstop against runaway allocation, not a
	// protocol constraint: every legitimate message is bounded by construction
	// far below this value (MaxSnapshotFrameSize for relay, a metadata-only
	// listSessions for RPC). Do not tune this downward to "catch" oversized
	// payloads — exceeding it closes the agent connection, which is the worst
	// possible response to a payload bug.
	AgentMaxMessageSize = 16 << 20
)

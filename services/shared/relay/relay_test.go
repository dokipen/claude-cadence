package relay

import "testing"

// TestMaxSnapshotFrameSize pins the worst-case relay frame to its components
// so a change to any one of them (ring buffer, ttyd prefix, relay header)
// cannot silently desynchronise the derived constant.
func TestMaxSnapshotFrameSize(t *testing.T) {
	want := MaxPTYBufferSize + TtydFramePrefixLen + TerminalFrameHeaderLen
	if MaxSnapshotFrameSize != want {
		t.Fatalf("MaxSnapshotFrameSize = %d, want MaxPTYBufferSize+TtydFramePrefixLen+TerminalFrameHeaderLen = %d", MaxSnapshotFrameSize, want)
	}
	if MaxSnapshotFrameSize != 1048593 {
		t.Errorf("MaxSnapshotFrameSize = %d, want 1048593 (1<<20 - 1 + 1 + 17)", MaxSnapshotFrameSize)
	}
}

// TestAgentMaxMessageSizeBackstopMargin asserts the hub's agent-connection
// read limit exceeds the largest legitimate frame by a comfortable margin.
// The backstop exists to catch bugs, never to police legitimate traffic; a
// full ring-buffer snapshot replay landing within a few bytes of it is
// exactly how issue #685 took agents offline.
func TestAgentMaxMessageSizeBackstopMargin(t *testing.T) {
	const minMargin = 4
	if AgentMaxMessageSize < minMargin*MaxSnapshotFrameSize {
		t.Fatalf("AgentMaxMessageSize (%d) must be at least %dx MaxSnapshotFrameSize (%d)",
			AgentMaxMessageSize, minMargin, MaxSnapshotFrameSize)
	}
}

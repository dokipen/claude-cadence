package metrics

import (
	"expvar"
	"sync"
	"time"
)

// Metrics tracks operational metrics for the agent-hub service.
var (
	// ConnectedAgents is the current number of registered agents (online + offline).
	ConnectedAgents = expvar.NewInt("connected_agents")

	// OnlineAgents is the current number of online agents.
	OnlineAgents = expvar.NewInt("online_agents")

	// ActiveTerminalSessions is the current number of active terminal proxy sessions.
	ActiveTerminalSessions = expvar.NewInt("active_terminal_sessions")

	// RequestsTotal is the total number of API requests served.
	RequestsTotal = expvar.NewInt("requests_total")

	// RequestLatencyAvgMs is the average request latency in milliseconds.
	RequestLatencyAvgMs = expvar.NewFloat("request_latency_avg_ms")

	latencyMu    sync.Mutex
	latencySum   int64
	latencyCount int64
)

// RecordRequestLatency records the latency of a single API request.
func RecordRequestLatency(d time.Duration) {
	RequestsTotal.Add(1)

	latencyMu.Lock()
	latencySum += d.Microseconds()
	latencyCount++
	avg := float64(latencySum) / float64(latencyCount) / 1000.0
	latencyMu.Unlock()

	RequestLatencyAvgMs.Set(avg)
}

// Snapshot populates the gauge metrics from live hub state.
// Call this periodically or before reading metrics.
func Snapshot(agentCount, onlineCount, terminalCount int) {
	ConnectedAgents.Set(int64(agentCount))
	OnlineAgents.Set(int64(onlineCount))
	ActiveTerminalSessions.Set(int64(terminalCount))
}

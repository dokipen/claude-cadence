package metrics

import (
	"expvar"
	"sync/atomic"
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

	// requestLatencySum and requestLatencyCount are used to compute average latency.
	requestLatencySum   atomic.Int64
	requestLatencyCount atomic.Int64

	// RequestLatencyAvgMs is the average request latency in milliseconds.
	RequestLatencyAvgMs = expvar.NewFloat("request_latency_avg_ms")
)

// RecordRequestLatency records the latency of a single API request.
func RecordRequestLatency(d time.Duration) {
	RequestsTotal.Add(1)
	requestLatencySum.Add(d.Microseconds())
	count := requestLatencyCount.Add(1)
	sum := requestLatencySum.Load()
	// Update rolling average.
	RequestLatencyAvgMs.Set(float64(sum) / float64(count) / 1000.0)
}

// Snapshot populates the gauge metrics from live hub state.
// Call this periodically or before reading metrics.
func Snapshot(agentCount, onlineCount, terminalCount int) {
	ConnectedAgents.Set(int64(agentCount))
	OnlineAgents.Set(int64(onlineCount))
	ActiveTerminalSessions.Set(int64(terminalCount))
}

module github.com/dokipen/claude-cadence/services/agents

go 1.25.0

require (
	github.com/coder/websocket v1.8.14
	github.com/creack/pty v1.1.24
	github.com/dokipen/claude-cadence/services/shared v0.0.0
	github.com/google/uuid v1.6.0
	gopkg.in/yaml.v3 v3.0.1
)

replace github.com/dokipen/claude-cadence/services/shared => ../shared

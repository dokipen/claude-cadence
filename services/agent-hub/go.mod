module github.com/dokipen/claude-cadence/services/agent-hub

go 1.25.0

require (
	github.com/coder/websocket v1.8.12
	github.com/dokipen/claude-cadence/services/shared v0.0.0
	github.com/google/uuid v1.6.0
	golang.org/x/sync v0.20.0
	golang.org/x/time v0.15.0
	gopkg.in/yaml.v3 v3.0.1
)

replace github.com/dokipen/claude-cadence/services/shared => ../shared

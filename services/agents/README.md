# agentd

Service for managing AI agent sessions via agent-hub WebSocket.

## Quick Start

### Prerequisites

- Go 1.23+

### Build

    make build

### Configure

    cp config.example.yaml config.yaml
    # Edit config.yaml with your profiles

### Run

    ./agentd --config config.yaml

### Test

    make test-e2e

## Documentation

- [Requirements](docs/REQUIREMENTS.md)
- [Plan](docs/PLAN.md)
- [Session Lifecycle](docs/user-stories/01-session-lifecycle.md)

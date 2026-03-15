.PHONY: build proto test test-e2e test-cleanup clean

BINARY := agentd
MODULE := github.com/dokipen/claude-cadence/services/agents

build:
	go build -o $(BINARY) ./cmd/agentd

proto:
	protoc --proto_path=proto \
		--go_out=. --go_opt=module=$(MODULE) \
		--go-grpc_out=. --go-grpc_opt=module=$(MODULE) \
		proto/agents/v1/agents.proto

test:
	go test -v ./...

test-e2e:
	go test -v -count=1 -timeout 120s ./test/e2e/

test-cleanup:
	@echo "Killing all e2e tmux sessions..."
	@tmux -L agentd list-sessions -F '#{session_name}' 2>/dev/null | grep '^e2e-' | xargs -I{} tmux -L agentd kill-session -t {} 2>/dev/null || true
	@echo "Done."

clean:
	rm -f $(BINARY)
	go clean ./...

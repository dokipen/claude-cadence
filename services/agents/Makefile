.PHONY: build build-linux proto test test-e2e test-cleanup clean deploy-agent

BINARY := agentd
BINARY_LINUX := agentd-linux
MODULE := github.com/dokipen/claude-cadence/services/agents

# NAME is required for deploy-agent (e.g., make deploy-agent NAME=bootsy)
NAME ?=

build:
	go build -o $(BINARY) ./cmd/agentd

build-linux:
	GOOS=linux GOARCH=amd64 go build -o $(BINARY_LINUX) ./cmd/agentd

deploy-agent:
ifndef NAME
	$(error NAME is required. Usage: make deploy-agent NAME=bootsy or make deploy-agent NAME=mac)
endif
ifeq ($(NAME),mac)
	$(MAKE) build
	bash install/deploy.sh --name $(NAME)
else
	$(MAKE) build-linux
	bash install/deploy.sh --name $(NAME) --host $(NAME)
endif

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
	rm -f $(BINARY) $(BINARY_LINUX)
	go clean ./...

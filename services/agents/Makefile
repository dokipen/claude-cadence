.PHONY: build build-linux test test-e2e clean deploy-agent

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

test:
	go test -v ./...

test-e2e:
	go test -v -count=1 -timeout 120s ./test/e2e/

clean:
	rm -f $(BINARY) $(BINARY_LINUX)
	go clean ./...

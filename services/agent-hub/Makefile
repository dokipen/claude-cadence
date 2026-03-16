.PHONY: build build-linux test clean deploy-hub verify-hub

BINARY := agent-hub
BINARY_LINUX := agent-hub-linux

build:
	go build -o $(BINARY) ./cmd/agent-hub

build-linux:
	GOOS=linux GOARCH=amd64 go build -o $(BINARY_LINUX) ./cmd/agent-hub

test:
	go test -v ./...

deploy-hub: build-linux
	bash install/deploy.sh

verify-hub:
	bash install/verify.sh

clean:
	rm -f $(BINARY) $(BINARY_LINUX)
	go clean ./...

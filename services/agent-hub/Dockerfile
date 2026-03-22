FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o agent-hub ./cmd/agent-hub

FROM alpine:3.21

RUN apk add --no-cache ca-certificates

RUN addgroup -S agent-hub && adduser -S agent-hub -G agent-hub

WORKDIR /app

COPY --from=builder /build/agent-hub ./agent-hub
COPY --chown=agent-hub:agent-hub config.container.yaml /etc/agent-hub/config.yaml

USER agent-hub

EXPOSE 4200

ENV AGENT_HUB_CONFIG=/etc/agent-hub/config.yaml

CMD ["./agent-hub"]

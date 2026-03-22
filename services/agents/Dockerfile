# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o agentd ./cmd/agentd

# Runtime stage
FROM node:22-alpine

RUN apk add --no-cache git ca-certificates

# Pin to exact version — the CLI has write access to the mounted ~/.claude
# credential directory, so floating versions are a supply-chain risk.
RUN npm install -g @anthropic-ai/claude-code@2.1.81

RUN addgroup -S agentd && adduser -S agentd -G agentd

RUN mkdir -p /var/lib/agentd && chown agentd:agentd /var/lib/agentd

WORKDIR /app

COPY --from=builder --chown=agentd:agentd /build/agentd ./

COPY --chown=agentd:agentd config.container.yaml /etc/agentd/config.yaml

ENV AGENTD_CONFIG=/etc/agentd/config.yaml

USER agentd

EXPOSE 4141 4142

CMD ["./agentd"]

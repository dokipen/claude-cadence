# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o agentd ./cmd/agentd

# Runtime stage
FROM alpine:3.21

RUN apk add --no-cache git ca-certificates bash

RUN addgroup -S agentd && adduser -S agentd -G agentd

RUN mkdir -p /var/lib/agentd && chown agentd:agentd /var/lib/agentd

WORKDIR /app

COPY --from=builder --chown=agentd:agentd /build/agentd ./

COPY --chown=agentd:agentd config.container.yaml /etc/agentd/config.yaml

ENV AGENTD_CONFIG=/etc/agentd/config.yaml

USER agentd

EXPOSE 4141 4142

CMD ["./agentd"]

package server

import (
	"context"
	"testing"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"google.golang.org/protobuf/types/known/emptypb"
)

type noopAgentService struct {
	agentsv1.UnimplementedAgentServiceServer
}

func (n *noopAgentService) CreateSession(ctx context.Context, req *agentsv1.CreateSessionRequest) (*agentsv1.CreateSessionResponse, error) {
	return nil, nil
}

func (n *noopAgentService) GetSession(ctx context.Context, req *agentsv1.GetSessionRequest) (*agentsv1.GetSessionResponse, error) {
	return nil, nil
}

func (n *noopAgentService) ListSessions(ctx context.Context, req *agentsv1.ListSessionsRequest) (*agentsv1.ListSessionsResponse, error) {
	return nil, nil
}

func (n *noopAgentService) DestroySession(ctx context.Context, req *agentsv1.DestroySessionRequest) (*emptypb.Empty, error) {
	return nil, nil
}

func baseConfig() *config.Config {
	return &config.Config{
		Host: "127.0.0.1",
		Port: 0,
		Auth: config.AuthConfig{Mode: "none"},
		Profiles: map[string]config.Profile{
			"test": {Command: "echo test"},
		},
	}
}

func TestNew_ReflectionDisabled(t *testing.T) {
	cfg := baseConfig()
	cfg.Reflection = false

	svc := &noopAgentService{}
	srv, err := New(svc, cfg)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	t.Cleanup(srv.Stop)

	info := srv.grpcServer.GetServiceInfo()
	for name := range info {
		if name == "grpc.reflection.v1.ServerReflection" || name == "grpc.reflection.v1alpha.ServerReflection" {
			t.Errorf("reflection service %q should not be registered when reflection is disabled", name)
		}
	}
}

func TestNew_ReflectionEnabled(t *testing.T) {
	cfg := baseConfig()
	cfg.Reflection = true

	svc := &noopAgentService{}
	srv, err := New(svc, cfg)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	t.Cleanup(srv.Stop)

	info := srv.grpcServer.GetServiceInfo()
	found := false
	for name := range info {
		if name == "grpc.reflection.v1.ServerReflection" || name == "grpc.reflection.v1alpha.ServerReflection" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected reflection service to be registered when reflection is enabled")
	}
}

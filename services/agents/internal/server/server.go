package server

import (
	"fmt"
	"net"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// Server wraps the gRPC server with reflection.
type Server struct {
	grpcServer *grpc.Server
	listener   net.Listener
}

// New creates a new Server with the given service registered.
func New(agentService agentsv1.AgentServiceServer, cfg *config.Config) (*Server, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("failed to listen on %s: %w", addr, err)
	}

	var opts []grpc.ServerOption

	if cfg.Auth.Mode == "token" {
		token := cfg.Auth.ResolveToken()
		opts = append(opts, grpc.UnaryInterceptor(tokenUnaryInterceptor(token)))
		opts = append(opts, grpc.StreamInterceptor(tokenStreamInterceptor(token)))
	}

	grpcServer := grpc.NewServer(opts...)
	agentsv1.RegisterAgentServiceServer(grpcServer, agentService)

	if cfg.Reflection {
		reflection.Register(grpcServer)
	}

	return &Server{
		grpcServer: grpcServer,
		listener:   lis,
	}, nil
}

// Start begins serving (blocking).
func (s *Server) Start() error {
	return s.grpcServer.Serve(s.listener)
}

// Stop performs a graceful shutdown.
func (s *Server) Stop() {
	s.grpcServer.GracefulStop()
}

// Addr returns the listener address.
func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

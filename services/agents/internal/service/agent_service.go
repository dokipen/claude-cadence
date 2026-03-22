package service

import (
	"context"
	"errors"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AgentService implements the gRPC AgentServiceServer interface.
type AgentService struct {
	agentsv1.UnimplementedAgentServiceServer
	manager *session.Manager
}

// NewAgentService creates a new AgentService.
func NewAgentService(manager *session.Manager) *AgentService {
	return &AgentService{manager: manager}
}

func (s *AgentService) CreateSession(_ context.Context, req *agentsv1.CreateSessionRequest) (*agentsv1.CreateSessionResponse, error) {
	createReq := session.CreateRequest{
		AgentProfile: req.GetAgentProfile(),
		SessionName:  req.GetSessionName(),
		BaseRef:      req.GetBaseRef(),
		Env:          req.GetEnv(),
		ExtraArgs:    req.GetExtraArgs(),
	}

	sess, err := s.manager.Create(createReq)
	if err != nil {
		return nil, mapError(err)
	}

	return &agentsv1.CreateSessionResponse{
		Session: sessionToProto(sess),
	}, nil
}

func (s *AgentService) GetSession(_ context.Context, req *agentsv1.GetSessionRequest) (*agentsv1.GetSessionResponse, error) {
	sess, err := s.manager.Get(req.GetSessionId())
	if err != nil {
		return nil, mapError(err)
	}

	return &agentsv1.GetSessionResponse{
		Session: sessionToProto(sess),
	}, nil
}

func (s *AgentService) ListSessions(_ context.Context, req *agentsv1.ListSessionsRequest) (*agentsv1.ListSessionsResponse, error) {
	sessions, err := s.manager.List(req.GetAgentProfile())
	if err != nil {
		return nil, mapError(err)
	}

	protoSessions := make([]*agentsv1.Session, len(sessions))
	for i, sess := range sessions {
		protoSessions[i] = sessionToProto(sess)
	}

	return &agentsv1.ListSessionsResponse{
		Sessions: protoSessions,
	}, nil
}

func (s *AgentService) DestroySession(_ context.Context, req *agentsv1.DestroySessionRequest) (*emptypb.Empty, error) {
	if err := s.manager.Destroy(req.GetSessionId(), req.GetForce()); err != nil {
		return nil, mapError(err)
	}
	return &emptypb.Empty{}, nil
}

func sessionToProto(sess *session.Session) *agentsv1.Session {
	if sess == nil {
		return nil
	}
	return &agentsv1.Session{
		Id:           sess.ID,
		Name:         sess.Name,
		AgentProfile: sess.AgentProfile,
		State:        stateToProto(sess.State),
		WorktreePath: sess.WorktreePath,
		RepoUrl:      sess.RepoURL,
		BaseRef:      sess.BaseRef,
		CreatedAt:    timestamppb.New(sess.CreatedAt),
		ErrorMessage: sess.ErrorMessage,
		AgentPid:     int32(sess.AgentPID),
		WebsocketUrl: sess.WebsocketURL,
	}
}

func stateToProto(state session.SessionState) agentsv1.SessionState {
	switch state {
	case session.StateCreating:
		return agentsv1.SessionState_SESSION_STATE_CREATING
	case session.StateRunning:
		return agentsv1.SessionState_SESSION_STATE_RUNNING
	case session.StateStopped:
		return agentsv1.SessionState_SESSION_STATE_STOPPED
	case session.StateError:
		return agentsv1.SessionState_SESSION_STATE_ERROR
	case session.StateDestroying:
		return agentsv1.SessionState_SESSION_STATE_DESTROYING
	default:
		return agentsv1.SessionState_SESSION_STATE_UNSPECIFIED
	}
}

func mapError(err error) error {
	var sessErr *session.Error
	if !errors.As(err, &sessErr) {
		return status.Error(codes.Internal, err.Error())
	}

	switch sessErr.Code {
	case session.ErrNotFound:
		return status.Error(codes.NotFound, sessErr.Message)
	case session.ErrAlreadyExists:
		return status.Error(codes.AlreadyExists, sessErr.Message)
	case session.ErrInvalidArgument:
		return status.Error(codes.InvalidArgument, sessErr.Message)
	case session.ErrFailedPrecondition:
		return status.Error(codes.FailedPrecondition, sessErr.Message)
	default:
		return status.Error(codes.Internal, sessErr.Message)
	}
}

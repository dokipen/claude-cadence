package server

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestValidateToken_ValidToken(t *testing.T) {
	md := metadata.Pairs("authorization", "Bearer secret123")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	if err := validateToken(ctx, "secret123"); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidateToken_MissingMetadata(t *testing.T) {
	ctx := context.Background()
	err := validateToken(ctx, "secret123")
	if err == nil {
		t.Fatal("expected error for missing metadata")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", code)
	}
}

func TestValidateToken_MissingAuthHeader(t *testing.T) {
	md := metadata.Pairs("content-type", "application/grpc")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	err := validateToken(ctx, "secret123")
	if err == nil {
		t.Fatal("expected error for missing authorization header")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", code)
	}
}

func TestValidateToken_WrongFormat(t *testing.T) {
	md := metadata.Pairs("authorization", "Basic abc123")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	err := validateToken(ctx, "secret123")
	if err == nil {
		t.Fatal("expected error for wrong authorization format")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", code)
	}
	st, _ := status.FromError(err)
	if st.Message() != "invalid authorization format" {
		t.Errorf("expected message %q, got %q", "invalid authorization format", st.Message())
	}
}

func TestValidateToken_WrongToken(t *testing.T) {
	md := metadata.Pairs("authorization", "Bearer wrongtoken")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	err := validateToken(ctx, "secret123")
	if err == nil {
		t.Fatal("expected error for wrong token")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", code)
	}
	st, _ := status.FromError(err)
	if st.Message() != "invalid token" {
		t.Errorf("expected message %q, got %q", "invalid token", st.Message())
	}
}

func TestValidateToken_EmptyBearer(t *testing.T) {
	md := metadata.Pairs("authorization", "Bearer ")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	err := validateToken(ctx, "secret123")
	if err == nil {
		t.Fatal("expected error for empty bearer token")
	}
	if code := status.Code(err); code != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", code)
	}
	st, _ := status.FromError(err)
	if st.Message() != "invalid token" {
		t.Errorf("expected message %q, got %q", "invalid token", st.Message())
	}
}

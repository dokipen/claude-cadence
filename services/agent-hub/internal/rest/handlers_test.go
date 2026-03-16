package rest

import (
	"net/http"
	"testing"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

func TestRpcCodeToHTTPStatus(t *testing.T) {
	tests := []struct {
		rpcCode    int
		httpStatus int
	}{
		{hub.RPCErrNotFound, http.StatusNotFound},
		{hub.RPCErrAlreadyExists, http.StatusConflict},
		{hub.RPCErrInvalidArgument, http.StatusBadRequest},
		{hub.RPCErrFailedPrecondition, http.StatusConflict},
		{hub.RPCErrInternal, http.StatusInternalServerError},
		{-99999, http.StatusInternalServerError},
	}

	for _, tt := range tests {
		got := rpcCodeToHTTPStatus(tt.rpcCode)
		if got != tt.httpStatus {
			t.Errorf("rpcCodeToHTTPStatus(%d): expected %d, got %d", tt.rpcCode, tt.httpStatus, got)
		}
	}
}

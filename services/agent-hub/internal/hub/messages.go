package hub

import "encoding/json"

// JSON-RPC 2.0 message types for the hub ↔ agentd protocol.

// Request is a JSON-RPC 2.0 request.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response is a JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RPCError       `json:"error,omitempty"`
}

// RPCError is a JSON-RPC 2.0 error object.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// RegisterParams is sent by agentd when it connects.
type RegisterParams struct {
	Name     string                    `json:"name"`
	Profiles map[string]ProfileInfo    `json:"profiles"`
	Ttyd     TtydInfo                  `json:"ttyd"`
}

// ProfileInfo describes an agent profile.
type ProfileInfo struct {
	Description string `json:"description"`
}

// TtydInfo describes the agentd's ttyd configuration.
type TtydInfo struct {
	AdvertiseAddress string `json:"advertise_address"`
	BasePort         int    `json:"base_port"`
}

// RegisterResult is returned by the hub to acknowledge registration.
type RegisterResult struct {
	Accepted bool `json:"accepted"`
}

// PongResult is returned by agentd in response to a ping.
type PongResult struct {
	Pong bool `json:"pong"`
}

// NewRequest creates a JSON-RPC 2.0 request.
func NewRequest(id, method string, params any) (*Request, error) {
	var raw json.RawMessage
	if params != nil {
		b, err := json.Marshal(params)
		if err != nil {
			return nil, err
		}
		raw = b
	}
	return &Request{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  raw,
	}, nil
}

// NewResponse creates a JSON-RPC 2.0 success response.
func NewResponse(id string, result any) (*Response, error) {
	b, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	return &Response{
		JSONRPC: "2.0",
		ID:      id,
		Result:  b,
	}, nil
}

// NewErrorResponse creates a JSON-RPC 2.0 error response.
func NewErrorResponse(id string, code int, message string) *Response {
	return &Response{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &RPCError{Code: code, Message: message},
	}
}

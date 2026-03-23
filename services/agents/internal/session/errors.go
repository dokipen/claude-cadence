package session

// ErrorCode represents a category of session error.
type ErrorCode int

const (
	ErrNotFound           ErrorCode = iota + 1
	ErrAlreadyExists
	ErrInvalidArgument
	ErrFailedPrecondition
	ErrInternal
	ErrResourceExhausted
)

// Error is a domain error with a code and message.
type Error struct {
	Code    ErrorCode
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

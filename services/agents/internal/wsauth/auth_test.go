package wsauth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// nextOK is a simple next handler that records whether it was called.
func nextOK(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

func TestTokenAuth_EmptyExpectedToken_PassesThrough(t *testing.T) {
	called := false
	handler := TokenAuth("", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("expected next handler to be called when expectedToken is empty")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestTokenAuth_NoAuthProvided_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("secret", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called when no auth provided")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_WrongTokenViaHeader_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("secret", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called when wrong token in header")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_WrongTokenViaQueryParam_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("secret", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws?token=wrong", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called when wrong token in query param")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_ValidTokenViaHeader_PassesThrough(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Authorization", "Bearer correct-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("expected next handler to be called with valid token in header")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestTokenAuth_ValidTokenViaQueryParam_PassesThrough(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	req := httptest.NewRequest(http.MethodGet, "/ws?token=correct-token", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("expected next handler to be called with valid token in query param")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestTokenAuth_HeaderTakesPrecedenceOverQueryParam(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	// Header has the correct token; query param has the wrong token.
	// The middleware should use the header value and allow the request.
	req := httptest.NewRequest(http.MethodGet, "/ws?token=wrong", nil)
	req.Header.Set("Authorization", "Bearer correct-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("expected next handler to be called when header token is valid (header takes precedence)")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestTokenAuth_HeaderWrongQueryParamCorrect_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	// Header has the wrong token; query param has the correct token.
	// Since header takes precedence, the wrong header value should cause 401.
	req := httptest.NewRequest(http.MethodGet, "/ws?token=correct-token", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called when header token is wrong (header takes precedence over query param)")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_MalformedHeader_NoBearerPrefix_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	// Authorization header present but without "Bearer " prefix.
	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	req.Header.Set("Authorization", "correct-token")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called when Authorization header lacks Bearer prefix")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_MalformedHeader_EmptyAfterPrefix_Returns401(t *testing.T) {
	called := false
	handler := TokenAuth("correct-token", nextOK(&called))

	// Authorization header is "Bearer " with no token value after the prefix.
	// Must not fall through to the ?token= query param.
	req := httptest.NewRequest(http.MethodGet, "/ws?token=correct-token", nil)
	req.Header.Set("Authorization", "Bearer ")
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if called {
		t.Error("expected next handler NOT to be called; malformed header must not fall through to query param")
	}
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestTokenAuth_401_IncludesWWWAuthenticateHeader(t *testing.T) {
	handler := TokenAuth("secret", nextOK(new(bool)))

	req := httptest.NewRequest(http.MethodGet, "/ws", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
	if got := rr.Header().Get("WWW-Authenticate"); got != "Bearer" {
		t.Errorf("expected WWW-Authenticate: Bearer, got %q", got)
	}
}

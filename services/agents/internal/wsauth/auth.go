package wsauth

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// TokenAuth returns an HTTP middleware that validates a bearer token before
// passing the request to next. The token is accepted from either:
//   - Authorization: Bearer <token> header
//   - ?token=<token> query parameter (fallback for browser WebSocket clients)
//
// On auth failure, responds with 401 Unauthorized before any WebSocket upgrade.
// If expectedToken is empty, the middleware allows all requests (auth disabled).
func TokenAuth(expectedToken string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if expectedToken == "" {
			next.ServeHTTP(w, r)
			return
		}

		var token string
		if auth := r.Header.Get("Authorization"); auth != "" {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
		if token == "" {
			token = r.URL.Query().Get("token")
		}

		if token == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

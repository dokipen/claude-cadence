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
			// If the Authorization header is present, it must be a valid Bearer token.
			// A malformed header (missing or empty value after "Bearer ") is rejected
			// immediately — we do not fall through to the query param fallback.
			const prefix = "Bearer "
			if !strings.HasPrefix(auth, prefix) || len(auth) == len(prefix) {
				w.Header().Set("WWW-Authenticate", "Bearer")
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			token = auth[len(prefix):]
		} else {
			// No Authorization header: fall back to ?token= query param, which is
			// required for browser-native WebSocket clients that cannot set headers.
			// Note: query param tokens appear in server/proxy logs — use short-lived
			// tokens or ensure log access is restricted.
			token = r.URL.Query().Get("token")
		}

		if token == "" {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

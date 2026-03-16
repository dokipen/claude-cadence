package rest

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"sync"

	"time"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/config"
	"github.com/dokipen/claude-cadence/services/agent-hub/internal/metrics"
	"golang.org/x/time/rate"
)

// tokenAuth returns middleware that validates Bearer token authentication.
func tokenAuth(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			const prefix = "Bearer "
			if !strings.HasPrefix(auth, prefix) {
				http.Error(w, "missing or invalid authorization header", http.StatusUnauthorized)
				return
			}

			provided := auth[len(prefix):]
			if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// metricsMiddleware records request latency.
func metricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		metrics.RecordRequestLatency(time.Since(start))
	})
}

// rateLimiter returns per-IP rate limiting middleware.
func rateLimiter(cfg config.RateLimitConfig) func(http.Handler) http.Handler {
	var mu sync.Mutex
	limiters := make(map[string]*rate.Limiter)

	getLimiter := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		if lim, ok := limiters[ip]; ok {
			return lim
		}
		lim := rate.NewLimiter(rate.Limit(cfg.RequestsPerSecond), cfg.Burst)
		limiters[ip] = lim
		return lim
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract IP from X-Forwarded-For (behind Caddy) or RemoteAddr.
			ip := r.Header.Get("X-Forwarded-For")
			if ip == "" {
				ip = r.RemoteAddr
			}
			// Take only the first IP if comma-separated.
			if idx := strings.IndexByte(ip, ','); idx != -1 {
				ip = strings.TrimSpace(ip[:idx])
			}
			// Strip port if present (RemoteAddr is "host:port").
			if idx := strings.LastIndexByte(ip, ':'); idx != -1 {
				// Avoid stripping from IPv6 addresses without brackets.
				if strings.Contains(ip, "[") || !strings.Contains(ip[:idx], ":") {
					ip = ip[:idx]
				}
			}

			if !getLimiter(ip).Allow() {
				writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

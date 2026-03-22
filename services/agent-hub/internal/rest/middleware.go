package rest

import (
	"crypto/subtle"
	"net"
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
// IP is extracted from RemoteAddr only — X-Forwarded-For is not trusted
// because the hub may receive direct connections. When deployed behind
// a trusted reverse proxy (Caddy), the proxy's own rate limiting should
// be used for client-IP-based throttling.
func rateLimiter(cfg config.RateLimitConfig) func(http.Handler) http.Handler {
	_, handler := rateLimiterInternal(cfg, time.Now)
	return handler
}

// rateLimiterInternal is the testable implementation; it returns both the
// middleware handler and a function that returns the current map length.
func rateLimiterInternal(cfg config.RateLimitConfig, now func() time.Time) (lenFunc func() int, handler func(http.Handler) http.Handler) {
	var mu sync.Mutex
	limiters := make(map[string]*rateLimiterEntry)

	getLimiter := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()

		t := now()

		// Evict stale entries older than 5 minutes.
		if len(limiters) >= 1000 {
			for k, e := range limiters {
				if t.Sub(e.lastSeen) > 5*time.Minute {
					delete(limiters, k)
				}
			}
		}

		if entry, ok := limiters[ip]; ok {
			entry.lastSeen = t
			return entry.limiter
		}
		lim := rate.NewLimiter(rate.Limit(cfg.RequestsPerSecond), cfg.Burst)
		limiters[ip] = &rateLimiterEntry{limiter: lim, lastSeen: t}
		return lim
	}

	lenFunc = func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(limiters)
	}

	handler = func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			if !getLimiter(ip).Allow() {
				writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	return lenFunc, handler
}

type rateLimiterEntry struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

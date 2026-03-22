package rest

import (
	"container/list"
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

// rateLimiterMaxEntries is the hard cap on the number of entries in the
// per-IP rate limiter map. Eviction fires when this limit is reached.
const rateLimiterMaxEntries = 300

// rateLimiterDeniedProtectionWindow is how long a denied entry is protected
// from LRU eviction after it was last rate-limited. After this window the
// entry is evictable again (the token bucket will have partially refilled).
const rateLimiterDeniedProtectionWindow = 2 * time.Minute

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

// cidrKey returns a masked CIDR prefix string for the given plain IP string
// (no port). IPv4 addresses are masked to /24 (e.g. 1.2.3.200 → 1.2.3.0)
// and IPv6 to /48. Grouping IPs by network prefix means all hosts in the same
// subnet share a single rate-limiter bucket, making it harder for an attacker
// to fill the map by rotating among IPs within one address block.
// If the input cannot be parsed as an IP, the raw string is returned unchanged.
func cidrKey(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if parsed.To4() != nil {
		// IPv4: mask to /24 (zero the last octet).
		mask := net.CIDRMask(24, 32)
		return parsed.Mask(mask).String()
	}
	// IPv6: mask to /48.
	mask := net.CIDRMask(48, 128)
	return parsed.Mask(mask).String()
}

// rateLimiter returns per-IP rate limiting middleware.
// IP is extracted from RemoteAddr only — X-Forwarded-For is not trusted
// because the hub may receive direct connections. When deployed behind
// a trusted reverse proxy (Caddy), the proxy's own rate limiting should
// be used for client-IP-based throttling.
func rateLimiter(cfg config.RateLimitConfig) func(http.Handler) http.Handler {
	_, _, handler := rateLimiterInternal(cfg, time.Now)
	return handler
}

// rateLimiterInternal is the testable implementation; it returns both the
// middleware handler and a function that returns the current map length, and
// a containsFunc for introspecting map membership in tests.
func rateLimiterInternal(cfg config.RateLimitConfig, nowFn func() time.Time) (lenFunc func() int, containsFunc func(key string) bool, handler func(http.Handler) http.Handler) {
	var mu sync.Mutex
	limiters := make(map[string]*lruEntry)
	lruList := list.New()

	getLimiter := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()

		// Fast path: returning client, move to front to mark most-recently-used.
		if entry, ok := limiters[ip]; ok {
			lruList.MoveToFront(entry.elem)
			return entry.limiter
		}

		// New IP: evict before inserting to enforce the hard cap.
		// Entries that have been rate-limited (denied=true) within the
		// protection window are exempt from LRU eviction to prevent
		// victim-eviction attacks that would reset the token bucket and
		// erase rate-limit debt.
		if len(limiters) >= rateLimiterMaxEntries {
			now := nowFn()

			// Walk from LRU tail toward front, find the least-recently-used
			// entry that is NOT within the denied protection window.
			var victimKey string
			for elem := lruList.Back(); elem != nil; elem = elem.Prev() {
				e := elem.Value.(*lruEntry)
				if e.denied && now.Sub(e.deniedAt) < rateLimiterDeniedProtectionWindow {
					// Protected: recently rate-limited, skip.
					continue
				}
				victimKey = e.key
				break
			}

			if victimKey == "" {
				// All entries are protected; fall back to unconditional LRU
				// eviction of the tail to keep the map bounded.
				if back := lruList.Back(); back != nil {
					victimKey = back.Value.(*lruEntry).key
				}
			}

			if victimKey != "" {
				victim := limiters[victimKey]
				lruList.Remove(victim.elem)
				delete(limiters, victimKey)
			}
		}

		lim := rate.NewLimiter(rate.Limit(cfg.RequestsPerSecond), cfg.Burst)
		entry := &lruEntry{limiter: lim, key: ip}
		elem := lruList.PushFront(entry)
		entry.elem = elem
		limiters[ip] = entry
		return lim
	}

	markDenied := func(ip string) {
		mu.Lock()
		defer mu.Unlock()
		if entry, ok := limiters[ip]; ok {
			entry.denied = true
			entry.deniedAt = nowFn()
		}
	}

	lenFunc = func() int {
		mu.Lock()
		defer mu.Unlock()
		return len(limiters)
	}

	containsFunc = func(key string) bool {
		mu.Lock()
		defer mu.Unlock()
		return limiters[key] != nil
	}

	handler = func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				ip = r.RemoteAddr
			}

			key := cidrKey(ip)
			if !getLimiter(key).Allow() {
				markDenied(key)
				writeJSONError(w, http.StatusTooManyRequests, "rate limit exceeded")
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	return lenFunc, containsFunc, handler
}

type lruEntry struct {
	key     string
	limiter *rate.Limiter
	elem    *list.Element
	// denied is set to true when this entry has been rate-limited at least
	// once. Recently denied entries are exempt from LRU eviction; see getLimiter.
	denied   bool
	deniedAt time.Time
}

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

// rateLimiterMaxEntries is the hard cap on the number of per-CIDR prefix
// entries in the rate limiter map (IPv4 /24 or IPv6 /48). Eviction fires
// when this limit is reached.
//
// Sizing rationale: keys are IPv4 /24 (or IPv6 /48) prefixes, so each
// entry covers up to 256 IPs. 300 entries ≈ 76,800 IPs of concurrent
// coverage — well above any realistic concurrent legitimate-client
// population (observed deployments use single-digit to low-tens of
// distinct /24 prefixes).
//
// The value was deliberately lowered from 1,000 (per-IP) to 300
// (per-/24) as a security hardening measure: with CIDR bucketing an
// attacker needs 300 distinct subnets (76,800+ individual IPs) to
// exhaust the map, vs. only 1,000 individual IPs under the old scheme.
//
// Formula: expected_concurrent_prefixes × 3 (headroom factor) = cap.
// If traffic analysis ever shows more than ~100 distinct prefixes active
// concurrently, scale up by the same factor (e.g. 200 prefixes → 600).
const rateLimiterMaxEntries = 300

// allProtectedLimiter is a sentinel returned when the rate-limiter map is at
// capacity and every entry is within the denied-protection window. Refusing
// admission here is safer than evicting a protected victim: it prevents an
// adversary with 300+ denied subnets from resetting a legitimate victim's
// token bucket by forcing fallback eviction.
//
// Allow() always returns false (burst=0, limit=0), so the caller issues a 429
// without inserting the new IP into the map or touching any existing entry.
var allProtectedLimiter = rate.NewLimiter(0, 0)


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
	// deniedProtectionWindow is how long a rate-limited entry is protected from
	// LRU eviction. It equals the token-bucket full-refill time (burst / rps):
	// once the burst has had time to fully replenish, the entry offers no
	// stronger protection against a fresh connection than a brand-new entry
	// would, so there is no reason to keep it pinned past that point.
	deniedProtectionWindow := time.Duration(float64(cfg.Burst)/cfg.RequestsPerSecond * float64(time.Second))

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
				if e.denied && now.Sub(e.deniedAt) < deniedProtectionWindow {
					// Protected: recently rate-limited, skip.
					continue
				}
				victimKey = e.key
				break
			}

			if victimKey == "" {
				// All entries are within the denied-protection window. Admitting
				// the new IP would require evicting a protected victim — refuse
				// admission instead.
				return allProtectedLimiter
			}

			victim := limiters[victimKey]
			lruList.Remove(victim.elem)
			delete(limiters, victimKey)
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

// MaxRestBodySize is the maximum number of bytes accepted in a REST request body (1 MiB).
const MaxRestBodySize = 1 << 20 // 1 MiB

// maxBodyMiddleware limits the size of request bodies to MaxRestBodySize bytes.
// Requests that exceed the limit will receive HTTP 413 Request Entity Too Large.
// This middleware should not be applied to WebSocket upgrade endpoints.
func maxBodyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, MaxRestBodySize)
		next.ServeHTTP(w, r)
	})
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

package hub

import (
	"fmt"
	"net"
	"net/url"
)

// ValidateAdvertiseAddress checks that addr is a valid address suitable for use
// as a terminal WebSocket advertise address. Accepts bare IPs ("10.0.0.1"),
// host:port with IPs ("10.0.0.1:8001"), and DNS hostnames ("agentd:4142") for
// Docker/Kubernetes environments. An empty string is accepted (terminal server
// disabled). For IP addresses, loopback, link-local, unspecified, and multicast
// addresses are rejected. DNS hostnames are accepted without resolution — they
// are validated at connection time.
func ValidateAdvertiseAddress(addr string) error {
	if addr == "" {
		return nil
	}

	// Try bare IP first, then host:port.
	host := addr
	ip := net.ParseIP(host)
	if ip == nil {
		var err error
		host, _, err = net.SplitHostPort(addr)
		if err != nil {
			// Not a valid IP and not host:port — could be a bare hostname.
			// Reject obvious junk but allow DNS names.
			if !isValidHostname(addr) {
				return fmt.Errorf("advertise address %q is not a valid IP, host:port, or hostname", addr)
			}
			return nil
		}
		ip = net.ParseIP(host)
		if ip == nil {
			// host:port where host is a DNS name (e.g., "agentd:4142").
			if !isValidHostname(host) {
				return fmt.Errorf("advertise address %q: host %q is not a valid IP or hostname", addr, host)
			}
			return nil
		}
	}

	if ip.IsLoopback() {
		return fmt.Errorf("advertise address %q is a loopback address", addr)
	}
	if ip.IsLinkLocalUnicast() {
		return fmt.Errorf("advertise address %q is a link-local unicast address", addr)
	}
	if ip.IsUnspecified() {
		return fmt.Errorf("advertise address %q is the unspecified address", addr)
	}
	if ip.IsMulticast() {
		return fmt.Errorf("advertise address %q is a multicast address", addr)
	}

	// RFC 1918 private ranges (10/8, 172.16/12, 192.168/16) are intentionally
	// allowed — agents are expected to run on private infrastructure.
	return nil
}

// isValidHostname checks that s looks like a DNS hostname: non-empty, no
// whitespace, no path separators, and within reasonable length limits.
func isValidHostname(s string) bool {
	if s == "" || len(s) > 253 {
		return false
	}
	for _, c := range s {
		if c == ' ' || c == '/' || c == '\\' {
			return false
		}
	}
	return true
}

// ValidateProfileType checks that typ is one of the accepted profile type
// values: "", "shell", or "agent". An empty string is accepted (type not
// specified). Any other value is rejected.
func ValidateProfileType(typ string) error {
	switch typ {
	case "", "shell", "agent":
		return nil
	default:
		return fmt.Errorf("profile type %q is invalid: must be \"\", \"shell\", or \"agent\"", typ)
	}
}

// ValidateProfileRepo checks that repo is either empty or a valid http/https
// URL. Empty strings are accepted (repo not specified). Plain strings, bare
// hostnames, and non-http schemes are rejected.
func ValidateProfileRepo(repo string) error {
	if repo == "" {
		return nil
	}

	const maxRepoLen = 2048
	if len(repo) > maxRepoLen {
		return fmt.Errorf("profile repo exceeds maximum length of %d characters", maxRepoLen)
	}

	u, err := url.Parse(repo)
	if err != nil {
		return fmt.Errorf("profile repo %q is not a valid URL", repo)
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("profile repo %q must use http or https scheme", repo)
	}

	if u.Host == "" {
		return fmt.Errorf("profile repo %q is missing a host", repo)
	}

	return nil
}

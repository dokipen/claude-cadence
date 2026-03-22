package hub

import (
	"fmt"
	"net"
	"net/url"
)

// ValidateAdvertiseAddress checks that addr is a valid, routable IP address
// suitable for use as a terminal WebSocket advertise address. Accepts either
// a bare IP ("10.0.0.1") or host:port ("10.0.0.1:8001"). An empty string is
// accepted (terminal server disabled). Loopback, link-local, unspecified, and
// multicast addresses are rejected.
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
			return fmt.Errorf("advertise address %q is not a valid IP or host:port", addr)
		}
		ip = net.ParseIP(host)
		if ip == nil {
			return fmt.Errorf("advertise address %q: host %q is not a valid IP", addr, host)
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

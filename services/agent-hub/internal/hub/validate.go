package hub

import (
	"fmt"
	"net"
	"net/url"
)

// ValidateAdvertiseAddress checks that addr is a valid, routable IP address
// suitable for use as a ttyd advertise address. An empty string is accepted
// (ttyd disabled). Loopback, link-local, unspecified, and multicast addresses
// are rejected.
func ValidateAdvertiseAddress(addr string) error {
	if addr == "" {
		return nil
	}

	ip := net.ParseIP(addr)
	if ip == nil {
		return fmt.Errorf("advertise address %q is not a valid IP address", addr)
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

package hub

import (
	"fmt"
	"net"
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
	if ip.IsLinkLocalMulticast() {
		return fmt.Errorf("advertise address %q is a link-local multicast address", addr)
	}
	if ip.IsUnspecified() {
		return fmt.Errorf("advertise address %q is the unspecified address", addr)
	}
	if ip.IsMulticast() {
		return fmt.Errorf("advertise address %q is a multicast address", addr)
	}

	return nil
}

package hub

import (
	"testing"
)

func TestValidateAdvertiseAddress(t *testing.T) {
	t.Helper()

	tests := []struct {
		name    string
		addr    string
		wantErr bool
	}{
		// Empty string: ttyd disabled, always valid.
		{name: "empty string", addr: "", wantErr: false},

		// Valid routable addresses.
		{name: "private RFC1918 10.x", addr: "10.0.0.1", wantErr: false},
		{name: "private RFC1918 172.16.x", addr: "172.16.0.1", wantErr: false},
		{name: "private RFC1918 192.168.x", addr: "192.168.1.1", wantErr: false},
		{name: "public IPv4", addr: "8.8.8.8", wantErr: false},
		{name: "IPv6 global unicast", addr: "2001:db8::1", wantErr: false},
		{name: "IPv6 global unicast 2", addr: "2600:1f18::1", wantErr: false},

		// Loopback addresses.
		{name: "IPv4 loopback", addr: "127.0.0.1", wantErr: true},
		{name: "IPv6 loopback", addr: "::1", wantErr: true},

		// Link-local unicast addresses.
		{name: "IPv4 link-local unicast", addr: "169.254.1.1", wantErr: true},
		{name: "IPv6 link-local unicast", addr: "fe80::1", wantErr: true},

		// Link-local multicast addresses.
		{name: "IPv6 link-local multicast", addr: "ff02::1", wantErr: true},

		// Unspecified addresses.
		{name: "IPv4 unspecified", addr: "0.0.0.0", wantErr: true},
		{name: "IPv6 unspecified", addr: "::", wantErr: true},

		// Multicast addresses.
		{name: "IPv4 multicast", addr: "224.0.0.1", wantErr: true},
		{name: "IPv6 multicast", addr: "ff00::1", wantErr: true},

		// Non-IP strings.
		{name: "hostname", addr: "my-host.local", wantErr: true},
		{name: "not an address", addr: "not-an-address", wantErr: true},

		// CIDR notation is not a plain IP.
		{name: "CIDR notation", addr: "10.0.0.0/8", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateAdvertiseAddress(tc.addr)
			if tc.wantErr && err == nil {
				t.Errorf("ValidateAdvertiseAddress(%q) = nil, want error", tc.addr)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("ValidateAdvertiseAddress(%q) = %v, want nil", tc.addr, err)
			}
		})
	}
}

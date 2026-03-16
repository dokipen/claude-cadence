package hub

import (
	"strings"
	"testing"
)

func TestValidateAdvertiseAddress(t *testing.T) {
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

func TestValidateProfileRepo(t *testing.T) {
	tests := []struct {
		name    string
		repo    string
		wantErr bool
	}{
		// Empty string: repo not specified, always valid.
		{name: "empty string", repo: "", wantErr: false},

		// Valid http/https URLs.
		{name: "valid https URL", repo: "https://github.com/org/repo", wantErr: false},
		{name: "valid http URL", repo: "http://github.com/org/repo", wantErr: false},
		{name: "https with port", repo: "https://git.example.com:8443/repo", wantErr: false},
		{name: "https with path and query", repo: "https://github.com/org/repo?tab=readme", wantErr: false},

		// Plain strings (no scheme).
		{name: "plain word", repo: "not-a-url", wantErr: true},
		{name: "plain words with spaces", repo: "not a url", wantErr: true},

		// Bare hostname without scheme.
		{name: "bare hostname", repo: "github.com/org/repo", wantErr: true},

		// Non-http schemes.
		{name: "ftp scheme", repo: "ftp://files.example.com/repo", wantErr: true},
		{name: "ssh scheme", repo: "ssh://git@github.com/org/repo", wantErr: true},
		{name: "git scheme", repo: "git://github.com/org/repo.git", wantErr: true},
		{name: "file scheme", repo: "file:///tmp/repo", wantErr: true},

		// Length limit.
		{name: "exceeds max length", repo: "https://github.com/" + strings.Repeat("a", 2049), wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateProfileRepo(tc.repo)
			if tc.wantErr && err == nil {
				t.Errorf("ValidateProfileRepo(%q) = nil, want error", tc.repo)
			}
			if !tc.wantErr && err != nil {
				t.Errorf("ValidateProfileRepo(%q) = %v, want nil", tc.repo, err)
			}
		})
	}
}

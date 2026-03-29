package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// validYAML returns a minimal valid YAML config string.
func validYAML() string {
	return `
host: 127.0.0.1
port: 4200
auth:
  mode: token
  token: test-secret
hub_auth:
  token: hub-secret
heartbeat:
  interval: 30s
  timeout: 10s
agent_ttl: 5m
`
}

// writeConfig is a test helper that writes YAML content to a temp file and
// returns the file path.
func writeConfig(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writing temp config: %v", err)
	}
	return path
}

// --- Load ---

func TestLoad_ValidYAML(t *testing.T) {
	path := writeConfig(t, validYAML())
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Host != "127.0.0.1" {
		t.Errorf("expected host 127.0.0.1, got %q", cfg.Host)
	}
	if cfg.Port != 4200 {
		t.Errorf("expected port 4200, got %d", cfg.Port)
	}
	if cfg.Auth.Token != "test-secret" {
		t.Errorf("expected auth token %q, got %q", "test-secret", cfg.Auth.Token)
	}
	if cfg.Heartbeat.Interval != 30*time.Second {
		t.Errorf("expected heartbeat interval 30s, got %v", cfg.Heartbeat.Interval)
	}
	if cfg.Heartbeat.Timeout != 10*time.Second {
		t.Errorf("expected heartbeat timeout 10s, got %v", cfg.Heartbeat.Timeout)
	}
	if cfg.AgentTTL != 5*time.Minute {
		t.Errorf("expected agent_ttl 5m, got %v", cfg.AgentTTL)
	}
}

func TestLoad_MissingFile(t *testing.T) {
	_, err := Load("/nonexistent/path/config.yaml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
	if !strings.Contains(err.Error(), "reading config file") {
		t.Errorf("expected 'reading config file' in error, got %q", err.Error())
	}
}

func TestLoad_InvalidYAML(t *testing.T) {
	path := writeConfig(t, "{{invalid yaml}}")
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid YAML")
	}
	if !strings.Contains(err.Error(), "parsing config file") {
		t.Errorf("expected 'parsing config file' in error, got %q", err.Error())
	}
}

// --- applyDefaults ---

func TestApplyDefaults_ZeroValueConfig(t *testing.T) {
	var cfg Config
	applyDefaults(&cfg)

	checks := []struct {
		name string
		got  any
		want any
	}{
		{"Host", cfg.Host, "127.0.0.1"},
		{"Port", cfg.Port, 4200},
		{"Auth.Mode", cfg.Auth.Mode, "token"},
		{"Heartbeat.RawInterval", cfg.Heartbeat.RawInterval, "30s"},
		{"Heartbeat.RawTimeout", cfg.Heartbeat.RawTimeout, "10s"},
		{"RawTTL", cfg.RawTTL, "5m"},
		{"RateLimit.RequestsPerSecond", cfg.RateLimit.RequestsPerSecond, 100.0},
		{"RateLimit.Burst", cfg.RateLimit.Burst, 200},
		{"Log.Level", cfg.Log.Level, "info"},
		{"Log.Format", cfg.Log.Format, "json"},
	}

	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			if c.got != c.want {
				t.Errorf("expected %v, got %v", c.want, c.got)
			}
		})
	}
}

func TestApplyDefaults_DoesNotOverrideExistingValues(t *testing.T) {
	cfg := Config{
		Host: "0.0.0.0",
		Port: 9999,
		Auth: AuthConfig{Mode: "none"},
		Heartbeat: HeartbeatConfig{
			RawInterval: "1m",
			RawTimeout:  "5s",
		},
		RawTTL:    "10m",
		RateLimit: RateLimitConfig{RequestsPerSecond: 50, Burst: 25},
		Log:       LogConfig{Level: "debug", Format: "text"},
	}
	applyDefaults(&cfg)

	if cfg.Host != "0.0.0.0" {
		t.Errorf("expected host preserved as 0.0.0.0, got %q", cfg.Host)
	}
	if cfg.Port != 9999 {
		t.Errorf("expected port preserved as 9999, got %d", cfg.Port)
	}
	if cfg.Auth.Mode != "none" {
		t.Errorf("expected auth mode preserved as none, got %q", cfg.Auth.Mode)
	}
	if cfg.RateLimit.RequestsPerSecond != 50 {
		t.Errorf("expected rate limit preserved as 50, got %f", cfg.RateLimit.RequestsPerSecond)
	}
}

// --- parseDurations ---

func TestParseDurations_ValidStrings(t *testing.T) {
	cfg := Config{
		Heartbeat: HeartbeatConfig{
			RawInterval: "1m",
			RawTimeout:  "15s",
		},
		RawTTL: "10m",
	}
	if err := parseDurations(&cfg); err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if cfg.Heartbeat.Interval != time.Minute {
		t.Errorf("expected interval 1m, got %v", cfg.Heartbeat.Interval)
	}
	if cfg.Heartbeat.Timeout != 15*time.Second {
		t.Errorf("expected timeout 15s, got %v", cfg.Heartbeat.Timeout)
	}
	if cfg.AgentTTL != 10*time.Minute {
		t.Errorf("expected agent_ttl 10m, got %v", cfg.AgentTTL)
	}
}

func TestParseDurations_InvalidStrings(t *testing.T) {
	tests := []struct {
		name        string
		interval    string
		timeout     string
		ttl         string
		wantContain string
	}{
		{
			name:        "invalid interval",
			interval:    "notaduration",
			timeout:     "10s",
			ttl:         "5m",
			wantContain: "heartbeat.interval",
		},
		{
			name:        "invalid timeout",
			interval:    "30s",
			timeout:     "notaduration",
			ttl:         "5m",
			wantContain: "heartbeat.timeout",
		},
		{
			name:        "invalid agent_ttl",
			interval:    "30s",
			timeout:     "10s",
			ttl:         "notaduration",
			wantContain: "agent_ttl",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := Config{
				Heartbeat: HeartbeatConfig{
					RawInterval: tt.interval,
					RawTimeout:  tt.timeout,
				},
				RawTTL: tt.ttl,
			}
			err := parseDurations(&cfg)
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tt.wantContain) {
				t.Errorf("expected error containing %q, got %q", tt.wantContain, err.Error())
			}
		})
	}
}

// --- validate ---

func TestValidate_AuthModeNoneOnLocalhost(t *testing.T) {
	hosts := []string{"127.0.0.1", "localhost", "::1"}
	for _, host := range hosts {
		t.Run(host, func(t *testing.T) {
			cfg := &Config{
				Host:    host,
				Auth:    AuthConfig{Mode: "none"},
				HubAuth: HubAuthConfig{Token: "hub-secret"},
				Heartbeat: HeartbeatConfig{
					Interval: 30 * time.Second,
					Timeout:  10 * time.Second,
				},
				AgentTTL: 5 * time.Minute,
			}
			if err := validate(cfg); err != nil {
				t.Errorf("expected no error, got: %v", err)
			}
		})
	}
}

func TestValidate_AuthModeNoneOnNonLocalhost(t *testing.T) {
	cfg := &Config{
		Host:    "0.0.0.0",
		Auth:    AuthConfig{Mode: "none"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for non-localhost without auth")
	}
	want := "authentication required for non-localhost bindings"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_AllowedOriginsUnsetOnNonLocalhost(t *testing.T) {
	cfg := &Config{
		Host:    "0.0.0.0",
		Auth:    AuthConfig{Mode: "token", Token: "secret"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for non-localhost without allowed_origins")
	}
	want := "allowed_origins required for non-localhost bindings (set allowed_origins or bind to loopback)"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_AllowedOriginsSetOnNonLocalhost(t *testing.T) {
	cfg := &Config{
		Host:           "0.0.0.0",
		Auth:           AuthConfig{Mode: "token", Token: "secret"},
		HubAuth:        HubAuthConfig{Token: "hub-secret"},
		AllowedOrigins: []string{"https://example.com"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error for non-localhost with allowed_origins set, got: %v", err)
	}
}

func TestValidate_TokenAuthWithoutTokenOrEnvVar(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "token"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for token auth without token value")
	}
	want := "auth.token or auth.token_env_var required for token authentication"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_TokenAuthWithToken(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "token", Token: "secret"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_TokenAuthWithEnvVar(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "token", TokenEnvVar: "MY_TOKEN"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_InvalidAuthMode(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "invalid"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for invalid auth mode")
	}
	if !strings.Contains(err.Error(), "invalid auth mode") {
		t.Errorf("expected error containing 'invalid auth mode', got %q", err.Error())
	}
}

func TestValidate_MissingHubAuthToken(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "token", Token: "secret"},
		HubAuth: HubAuthConfig{},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for missing hub_auth token")
	}
	want := "hub_auth.token or hub_auth.token_env_var required"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_ZeroDurations(t *testing.T) {
	tests := []struct {
		name        string
		interval    time.Duration
		timeout     time.Duration
		ttl         time.Duration
		wantContain string
	}{
		{
			name:        "zero heartbeat interval",
			interval:    0,
			timeout:     10 * time.Second,
			ttl:         5 * time.Minute,
			wantContain: "heartbeat.interval must be positive",
		},
		{
			name:        "zero heartbeat timeout",
			interval:    30 * time.Second,
			timeout:     0,
			ttl:         5 * time.Minute,
			wantContain: "heartbeat.timeout must be positive",
		},
		{
			name:        "zero agent TTL",
			interval:    30 * time.Second,
			timeout:     10 * time.Second,
			ttl:         0,
			wantContain: "agent_ttl must be positive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &Config{
				Host:    "127.0.0.1",
				Auth:    AuthConfig{Mode: "token", Token: "secret"},
				HubAuth: HubAuthConfig{Token: "hub-secret"},
				Heartbeat: HeartbeatConfig{
					Interval: tt.interval,
					Timeout:  tt.timeout,
				},
				AgentTTL: tt.ttl,
			}
			err := validate(cfg)
			if err == nil {
				t.Fatal("expected error")
			}
			if err.Error() != tt.wantContain {
				t.Errorf("expected %q, got %q", tt.wantContain, err.Error())
			}
		})
	}
}

func TestValidate_NegativeRateLimitFields(t *testing.T) {
	base := func() *Config {
		return &Config{
			Host:    "127.0.0.1",
			Auth:    AuthConfig{Mode: "token", Token: "secret"},
			HubAuth: HubAuthConfig{Token: "hub-secret"},
			Heartbeat: HeartbeatConfig{
				Interval: 30 * time.Second,
				Timeout:  10 * time.Second,
			},
			AgentTTL: 5 * time.Minute,
		}
	}

	t.Run("negative requests_per_second", func(t *testing.T) {
		cfg := base()
		cfg.RateLimit = RateLimitConfig{RequestsPerSecond: -1, Burst: 10}
		err := validate(cfg)
		if err == nil {
			t.Fatal("expected error for negative requests_per_second")
		}
		want := "rate_limit.requests_per_second must not be negative"
		if err.Error() != want {
			t.Errorf("expected %q, got %q", want, err.Error())
		}
	})

	t.Run("negative burst", func(t *testing.T) {
		cfg := base()
		cfg.RateLimit = RateLimitConfig{RequestsPerSecond: 10, Burst: -1}
		err := validate(cfg)
		if err == nil {
			t.Fatal("expected error for negative burst")
		}
		want := "rate_limit.burst must not be negative"
		if err.Error() != want {
			t.Errorf("expected %q, got %q", want, err.Error())
		}
	})
}

func TestValidate_NegativeIdleTimeout(t *testing.T) {
	cfg := &Config{
		Host:    "127.0.0.1",
		Auth:    AuthConfig{Mode: "token", Token: "secret"},
		HubAuth: HubAuthConfig{Token: "hub-secret"},
		Heartbeat: HeartbeatConfig{
			Interval: 30 * time.Second,
			Timeout:  10 * time.Second,
		},
		AgentTTL: 5 * time.Minute,
		Terminal: TerminalConfig{IdleTimeout: -1 * time.Second},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for negative idle_timeout")
	}
	want := "terminal.idle_timeout must not be negative"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

// --- AuthConfig.ResolveToken ---

func TestAuthConfig_ResolveToken_InlineToken(t *testing.T) {
	a := &AuthConfig{Token: "hardcoded"}
	if got := a.ResolveToken(); got != "hardcoded" {
		t.Errorf("expected %q, got %q", "hardcoded", got)
	}
}

func TestAuthConfig_ResolveToken_EnvVarOverride(t *testing.T) {
	t.Setenv("TEST_AUTH_TOKEN", "fromenv")
	a := &AuthConfig{Token: "hardcoded", TokenEnvVar: "TEST_AUTH_TOKEN"}
	if got := a.ResolveToken(); got != "fromenv" {
		t.Errorf("expected %q, got %q", "fromenv", got)
	}
}

func TestAuthConfig_ResolveToken_EmptyEnvVarFallback(t *testing.T) {
	t.Setenv("TEST_AUTH_TOKEN", "")
	a := &AuthConfig{Token: "fallback", TokenEnvVar: "TEST_AUTH_TOKEN"}
	if got := a.ResolveToken(); got != "fallback" {
		t.Errorf("expected %q, got %q", "fallback", got)
	}
}

// --- HubAuthConfig.ResolveToken ---

func TestHubAuthConfig_ResolveToken_InlineToken(t *testing.T) {
	h := &HubAuthConfig{Token: "hub-hardcoded"}
	if got := h.ResolveToken(); got != "hub-hardcoded" {
		t.Errorf("expected %q, got %q", "hub-hardcoded", got)
	}
}

func TestHubAuthConfig_ResolveToken_EnvVarOverride(t *testing.T) {
	t.Setenv("TEST_HUB_TOKEN", "hub-fromenv")
	h := &HubAuthConfig{Token: "hub-hardcoded", TokenEnvVar: "TEST_HUB_TOKEN"}
	if got := h.ResolveToken(); got != "hub-fromenv" {
		t.Errorf("expected %q, got %q", "hub-fromenv", got)
	}
}

func TestHubAuthConfig_ResolveToken_EmptyEnvVarFallback(t *testing.T) {
	t.Setenv("TEST_HUB_TOKEN", "")
	h := &HubAuthConfig{Token: "hub-fallback", TokenEnvVar: "TEST_HUB_TOKEN"}
	if got := h.ResolveToken(); got != "hub-fallback" {
		t.Errorf("expected %q, got %q", "hub-fallback", got)
	}
}

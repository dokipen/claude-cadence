package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level agent-hub configuration.
type Config struct {
	Host           string          `yaml:"host"`
	Port           int             `yaml:"port"`
	Auth           AuthConfig      `yaml:"auth"`
	HubAuth        HubAuthConfig   `yaml:"hub_auth"`
	AllowedOrigins []string        `yaml:"allowed_origins"`
	Heartbeat      HeartbeatConfig `yaml:"heartbeat"`
	AgentTTL       time.Duration   `yaml:"-"`
	RawTTL         string          `yaml:"agent_ttl"`
	RateLimit      RateLimitConfig `yaml:"rate_limit"`
	Log            LogConfig       `yaml:"log"`
	Terminal       TerminalConfig  `yaml:"terminal"`
}

// TerminalConfig holds terminal proxy settings.
type TerminalConfig struct {
	MaxSessions    int           `yaml:"max_sessions"`
	IdleTimeout    time.Duration `yaml:"-"`
	RawIdleTimeout string        `yaml:"idle_timeout"`
	// TokenEnvVar is the environment variable containing the Bearer token
	// to send when dialing agentd's terminal WebSocket endpoint. Required
	// when agentd uses token auth (non-localhost bindings).
	TokenEnvVar string `yaml:"token_env_var"`
}

// ResolveToken returns the terminal proxy token from the env var, or empty string.
func (t *TerminalConfig) ResolveToken() string {
	if t.TokenEnvVar != "" {
		return os.Getenv(t.TokenEnvVar)
	}
	return ""
}

// RateLimitConfig holds rate limiting settings for the REST API.
type RateLimitConfig struct {
	RequestsPerSecond float64 `yaml:"requests_per_second"`
	Burst             int     `yaml:"burst"`
}

// AuthConfig holds REST API authentication settings.
type AuthConfig struct {
	Mode        string `yaml:"mode"`
	Token       string `yaml:"token"`
	TokenEnvVar string `yaml:"token_env_var"`
}

// ResolveToken returns the token, preferring the env var if set.
func (a *AuthConfig) ResolveToken() string {
	if a.TokenEnvVar != "" {
		if v := os.Getenv(a.TokenEnvVar); v != "" {
			return v
		}
	}
	return a.Token
}

// HubAuthConfig holds agent-to-hub authentication settings.
type HubAuthConfig struct {
	Token       string `yaml:"token"`
	TokenEnvVar string `yaml:"token_env_var"`
}

// ResolveToken returns the hub agent token, preferring the env var if set.
func (h *HubAuthConfig) ResolveToken() string {
	if h.TokenEnvVar != "" {
		if v := os.Getenv(h.TokenEnvVar); v != "" {
			return v
		}
	}
	return h.Token
}

// HeartbeatConfig holds heartbeat timing settings.
type HeartbeatConfig struct {
	Interval             time.Duration `yaml:"-"`
	Timeout              time.Duration `yaml:"-"`
	KeepaliveInterval    time.Duration `yaml:"-"`
	RawInterval          string        `yaml:"interval"`
	RawTimeout           string        `yaml:"timeout"`
	RawKeepaliveInterval string        `yaml:"keepalive_interval"`
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
	Path   string `yaml:"path"` // path to stderr log file; empty = use journald on Linux
}

// Load reads and validates a YAML config file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config file: %w", err)
	}

	applyDefaults(&cfg)

	if err := parseDurations(&cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	if err := validate(&cfg); err != nil {
		return nil, fmt.Errorf("validating config: %w", err)
	}

	return &cfg, nil
}

func applyDefaults(cfg *Config) {
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	if cfg.Port == 0 {
		cfg.Port = 4200
	}
	if cfg.Auth.Mode == "" {
		cfg.Auth.Mode = "token"
	}
	if cfg.Heartbeat.RawInterval == "" {
		cfg.Heartbeat.RawInterval = "30s"
	}
	if cfg.Heartbeat.RawTimeout == "" {
		cfg.Heartbeat.RawTimeout = "10s"
	}
	if cfg.Heartbeat.RawKeepaliveInterval == "" {
		cfg.Heartbeat.RawKeepaliveInterval = "15s"
	}
	if cfg.RawTTL == "" {
		cfg.RawTTL = "5m"
	}
	if cfg.RateLimit.RequestsPerSecond == 0 {
		cfg.RateLimit.RequestsPerSecond = 100
	}
	if cfg.RateLimit.Burst == 0 {
		cfg.RateLimit.Burst = 200
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "json"
	}
}

func parseDurations(cfg *Config) error {
	interval, err := time.ParseDuration(cfg.Heartbeat.RawInterval)
	if err != nil {
		return fmt.Errorf("heartbeat.interval: %w", err)
	}
	cfg.Heartbeat.Interval = interval

	timeout, err := time.ParseDuration(cfg.Heartbeat.RawTimeout)
	if err != nil {
		return fmt.Errorf("heartbeat.timeout: %w", err)
	}
	cfg.Heartbeat.Timeout = timeout

	if cfg.Heartbeat.RawKeepaliveInterval != "" {
		keepalive, err := time.ParseDuration(cfg.Heartbeat.RawKeepaliveInterval)
		if err != nil {
			return fmt.Errorf("heartbeat.keepalive_interval: %w", err)
		}
		cfg.Heartbeat.KeepaliveInterval = keepalive
	}

	ttl, err := time.ParseDuration(cfg.RawTTL)
	if err != nil {
		return fmt.Errorf("agent_ttl: %w", err)
	}
	cfg.AgentTTL = ttl

	if cfg.Terminal.RawIdleTimeout != "" {
		idleTimeout, err := time.ParseDuration(cfg.Terminal.RawIdleTimeout)
		if err != nil {
			return fmt.Errorf("terminal.idle_timeout: %w", err)
		}
		cfg.Terminal.IdleTimeout = idleTimeout
	}

	return nil
}

func validate(cfg *Config) error {
	// Require authentication for non-loopback bindings.
	hostLower := strings.ToLower(cfg.Host)
	if hostLower != "127.0.0.1" && hostLower != "localhost" && hostLower != "::1" {
		if cfg.Auth.Mode == "none" {
			return fmt.Errorf("authentication required for non-localhost bindings")
		}
		if len(cfg.AllowedOrigins) == 0 {
			return fmt.Errorf("allowed_origins required for non-localhost bindings (set allowed_origins or bind to loopback)")
		}
	}

	switch cfg.Auth.Mode {
	case "none":
		// ok — only allowed on localhost
	case "token":
		if cfg.Auth.Token == "" && cfg.Auth.TokenEnvVar == "" {
			return fmt.Errorf("auth.token or auth.token_env_var required for token authentication")
		}
	default:
		return fmt.Errorf("invalid auth mode %q: must be \"none\" or \"token\"", cfg.Auth.Mode)
	}

	if cfg.HubAuth.Token == "" && cfg.HubAuth.TokenEnvVar == "" {
		return fmt.Errorf("hub_auth.token or hub_auth.token_env_var required")
	}

	if cfg.Heartbeat.Interval <= 0 {
		return fmt.Errorf("heartbeat.interval must be positive")
	}
	if cfg.Heartbeat.Timeout <= 0 {
		return fmt.Errorf("heartbeat.timeout must be positive")
	}
	if cfg.AgentTTL <= 0 {
		return fmt.Errorf("agent_ttl must be positive")
	}
	if cfg.Heartbeat.KeepaliveInterval < 0 {
		return fmt.Errorf("heartbeat.keepalive_interval must not be negative (set to 0 to disable)")
	}
	// Note: zero values are already replaced by applyDefaults, so a negative
	// value here means the user explicitly set a nonsensical config.
	if cfg.RateLimit.RequestsPerSecond < 0 {
		return fmt.Errorf("rate_limit.requests_per_second must not be negative")
	}
	if cfg.RateLimit.Burst < 0 {
		return fmt.Errorf("rate_limit.burst must not be negative")
	}
	if cfg.Terminal.IdleTimeout < 0 {
		return fmt.Errorf("terminal.idle_timeout must not be negative")
	}

	return nil
}

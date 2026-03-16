package config

import (
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level agent-hub configuration.
type Config struct {
	Host      string        `yaml:"host"`
	Port      int           `yaml:"port"`
	Auth      AuthConfig    `yaml:"auth"`
	HubAuth   HubAuthConfig `yaml:"hub_auth"`
	Heartbeat HeartbeatConfig `yaml:"heartbeat"`
	AgentTTL  time.Duration `yaml:"-"`
	RawTTL    string        `yaml:"agent_ttl"`
	Log       LogConfig     `yaml:"log"`
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
	Interval    time.Duration `yaml:"-"`
	Timeout     time.Duration `yaml:"-"`
	RawInterval string        `yaml:"interval"`
	RawTimeout  string        `yaml:"timeout"`
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
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
	if cfg.RawTTL == "" {
		cfg.RawTTL = "5m"
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

	ttl, err := time.ParseDuration(cfg.RawTTL)
	if err != nil {
		return fmt.Errorf("agent_ttl: %w", err)
	}
	cfg.AgentTTL = ttl

	return nil
}

func validate(cfg *Config) error {
	switch cfg.Auth.Mode {
	case "none":
		// ok
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

	return nil
}

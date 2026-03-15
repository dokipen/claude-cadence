package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// AuthConfig holds authentication settings.
type AuthConfig struct {
	Mode        string `yaml:"mode"`          // "none", "token"
	Token       string `yaml:"token"`         // shared bearer token
	TokenEnvVar string `yaml:"token_env_var"` // env var override for token
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

// Config is the top-level agentd configuration.
type Config struct {
	Host       string             `yaml:"host"`
	Port       int                `yaml:"port"`
	RootDir    string             `yaml:"root_dir"`
	Tmux       TmuxConfig         `yaml:"tmux"`
	Ttyd       TtydConfig         `yaml:"ttyd"`
	Log        LogConfig          `yaml:"log"`
	Profiles   map[string]Profile `yaml:"profiles"`
	Auth       AuthConfig         `yaml:"auth"`
	Reflection bool               `yaml:"reflection"`
}

// TmuxConfig holds tmux-specific settings.
type TmuxConfig struct {
	SocketName string `yaml:"socket_name"`
}

// TtydConfig holds ttyd websocket terminal settings.
type TtydConfig struct {
	Enabled  bool `yaml:"enabled"`
	BasePort int  `yaml:"base_port"`
}

// LogConfig holds logging settings.
type LogConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
}

// Profile defines an agent profile with its command and repo.
type Profile struct {
	Repo        string `yaml:"repo"`
	Command     string `yaml:"command"`
	Description string `yaml:"description"`
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
		cfg.Port = 4141
	}
	if cfg.Tmux.SocketName == "" {
		cfg.Tmux.SocketName = "agentd"
	}
	if cfg.Ttyd.BasePort == 0 {
		cfg.Ttyd.BasePort = 7681
	}
	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "json"
	}
	if cfg.Auth.Mode == "" {
		cfg.Auth.Mode = "none"
	}
}

func validate(cfg *Config) error {
	if len(cfg.Profiles) == 0 {
		return fmt.Errorf("at least one profile must be defined")
	}
	for name, p := range cfg.Profiles {
		if p.Command == "" {
			return fmt.Errorf("profile %q: command is required", name)
		}
	}

	// Require authentication for non-loopback bindings.
	if cfg.Host != "127.0.0.1" && cfg.Host != "localhost" && cfg.Host != "::1" {
		if cfg.Auth.Mode == "none" {
			return fmt.Errorf("authentication required for non-localhost bindings")
		}
	}

	// Auth mode validation.
	switch cfg.Auth.Mode {
	case "none":
		// ok
	case "token":
		if cfg.Auth.Token == "" && cfg.Auth.TokenEnvVar == "" {
			return fmt.Errorf("token or token_env_var required for token authentication")
		}
	default:
		return fmt.Errorf("invalid auth mode %q: must be \"none\" or \"token\"", cfg.Auth.Mode)
	}

	return nil
}

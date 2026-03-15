package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config is the top-level agentd configuration.
type Config struct {
	Host     string             `yaml:"host"`
	Port     int                `yaml:"port"`
	RootDir  string             `yaml:"root_dir"`
	Tmux     TmuxConfig         `yaml:"tmux"`
	Log      LogConfig          `yaml:"log"`
	Profiles map[string]Profile `yaml:"profiles"`
}

// TmuxConfig holds tmux-specific settings.
type TmuxConfig struct {
	SocketName string `yaml:"socket_name"`
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
	if cfg.Log.Level == "" {
		cfg.Log.Level = "info"
	}
	if cfg.Log.Format == "" {
		cfg.Log.Format = "json"
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
	return nil
}

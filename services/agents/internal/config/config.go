package config

import (
	"fmt"
	"log/slog"
	"os"
	"time"

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

// VaultConfig holds HashiCorp Vault connection settings.
type VaultConfig struct {
	Address    string `yaml:"address"`     // Vault server address
	AuthMethod string `yaml:"auth_method"` // "token" or "approle"

	// Token auth fields.
	Token       string `yaml:"token"`
	TokenEnvVar string `yaml:"token_env_var"` // env var override (default: VAULT_TOKEN)

	// AppRole auth fields.
	RoleID         string `yaml:"role_id"`
	SecretID       string `yaml:"secret_id"`
	SecretIDEnvVar string `yaml:"secret_id_env_var"` // env var override for secret_id
}

// ResolveToken returns the Vault token, preferring the env var if set.
func (v *VaultConfig) ResolveToken() string {
	envVar := v.TokenEnvVar
	if envVar == "" {
		envVar = "VAULT_TOKEN"
	}
	if val := os.Getenv(envVar); val != "" {
		return val
	}
	return v.Token
}

// ResolveSecretID returns the AppRole secret ID, preferring the env var if set.
func (v *VaultConfig) ResolveSecretID() string {
	if v.SecretIDEnvVar != "" {
		if val := os.Getenv(v.SecretIDEnvVar); val != "" {
			return val
		}
	}
	return v.SecretID
}

// HubConfig holds optional hub connection settings.
type HubConfig struct {
	URL               string        `yaml:"url"`
	Name              string        `yaml:"name"`
	Token             string        `yaml:"token"`
	TokenEnvVar       string        `yaml:"token_env_var"`
	ReconnectInterval time.Duration `yaml:"-"`
	RawReconnect      string        `yaml:"reconnect_interval"`
}

// ResolveToken returns the hub token, preferring the env var if set.
func (h *HubConfig) ResolveToken() string {
	if h.TokenEnvVar != "" {
		if v := os.Getenv(h.TokenEnvVar); v != "" {
			return v
		}
	}
	return h.Token
}

// Config is the top-level agentd configuration.
type Config struct {
	Host       string             `yaml:"host"`
	Port       int                `yaml:"port"`
	RootDir    string             `yaml:"root_dir"`
	Tmux       TmuxConfig         `yaml:"tmux"` // Deprecated: unused after tmux removal
	Ttyd       TtydConfig         `yaml:"ttyd"` // Deprecated: unused after tmux removal
	PTY        PTYConfig          `yaml:"pty"`
	Log        LogConfig          `yaml:"log"`
	Profiles   map[string]Profile `yaml:"profiles"`
	Auth       AuthConfig         `yaml:"auth"`
	Vault      *VaultConfig       `yaml:"vault"`
	Reflection bool               `yaml:"reflection"`
	Cleanup    CleanupConfig      `yaml:"cleanup"`
	Hub        *HubConfig         `yaml:"hub"`
}

// CleanupConfig holds stale session cleanup settings.
type CleanupConfig struct {
	StaleSessionTTL time.Duration `yaml:"-"`
	ReapInterval    time.Duration `yaml:"-"`
	RawTTL          string        `yaml:"stale_session_ttl"`
	RawReapInterval string        `yaml:"session_reap_interval"`
}

// TmuxConfig holds tmux-specific settings.
type TmuxConfig struct {
	SocketName string `yaml:"socket_name"`
}

// TtydConfig holds ttyd websocket terminal settings.
type TtydConfig struct {
	Enabled          bool   `yaml:"enabled"`
	BasePort         int    `yaml:"base_port"`
	MaxPorts         int    `yaml:"max_ports"`
	BindAddress      string `yaml:"bind_address"`
	AdvertiseAddress string `yaml:"advertise_address"`
}

// PTYConfig holds PTY manager settings.
type PTYConfig struct {
	BufferSize      int    `yaml:"buffer_size"`      // ring buffer size in bytes; defaults to 1 MB
	WebSocketScheme string `yaml:"websocket_scheme"` // "ws" or "wss"; defaults to "ws"
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
	VaultSecret string `yaml:"vault_secret"` // Vault path for credentials (e.g. "secret/data/agentd/github/repo")
	PluginDir   string `yaml:"plugin_dir"`   // Claude Code plugin directory (available as {{.PluginDir}} in command template)
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
		cfg.Port = 4141
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
	if cfg.Cleanup.RawTTL == "" {
		cfg.Cleanup.RawTTL = "1h"
	}
	if cfg.Cleanup.RawReapInterval == "" {
		cfg.Cleanup.RawReapInterval = "30s"
	}
	if cfg.Hub != nil {
		if cfg.Hub.RawReconnect == "" {
			cfg.Hub.RawReconnect = "5s"
		}
	}
	if cfg.PTY.BufferSize == 0 {
		cfg.PTY.BufferSize = 1048576
	}
	if cfg.PTY.WebSocketScheme == "" {
		cfg.PTY.WebSocketScheme = "ws"
	}
}

func parseDurations(cfg *Config) error {
	ttl, err := time.ParseDuration(cfg.Cleanup.RawTTL)
	if err != nil {
		return fmt.Errorf("cleanup.stale_session_ttl: %w", err)
	}
	cfg.Cleanup.StaleSessionTTL = ttl

	reapInterval, err := time.ParseDuration(cfg.Cleanup.RawReapInterval)
	if err != nil {
		return fmt.Errorf("cleanup.session_reap_interval: %w", err)
	}
	cfg.Cleanup.ReapInterval = reapInterval

	if cfg.Hub != nil {
		reconnect, err := time.ParseDuration(cfg.Hub.RawReconnect)
		if err != nil {
			return fmt.Errorf("hub.reconnect_interval: %w", err)
		}
		cfg.Hub.ReconnectInterval = reconnect
	}

	return nil
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

	// Cleanup validation.
	if cfg.Cleanup.ReapInterval <= 0 {
		return fmt.Errorf("cleanup.session_reap_interval must be positive")
	}
	if cfg.Cleanup.StaleSessionTTL <= 0 {
		return fmt.Errorf("cleanup.stale_session_ttl must be positive")
	}

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

	// Vault config validation.
	if cfg.Vault != nil {
		if cfg.Vault.Address == "" {
			return fmt.Errorf("vault.address is required when vault is configured")
		}
		switch cfg.Vault.AuthMethod {
		case "token":
			// Token is resolved at runtime from env var.
		case "approle":
			if cfg.Vault.RoleID == "" {
				return fmt.Errorf("vault.role_id is required for approle auth")
			}
		default:
			return fmt.Errorf("invalid vault.auth_method %q: must be \"token\" or \"approle\"", cfg.Vault.AuthMethod)
		}
	}

	// Validate profiles with vault_secret have vault configured.
	for name, p := range cfg.Profiles {
		if p.VaultSecret != "" && cfg.Vault == nil {
			return fmt.Errorf("profile %q has vault_secret but no vault config", name)
		}
	}

	// Validate PTY config.
	switch cfg.PTY.WebSocketScheme {
	case "ws", "wss":
		// ok
	default:
		return fmt.Errorf("invalid pty.websocket_scheme %q: must be \"ws\" or \"wss\"", cfg.PTY.WebSocketScheme)
	}

	// Validate hub config.
	if cfg.Hub != nil {
		if cfg.Hub.URL == "" {
			return fmt.Errorf("hub.url is required when hub is configured")
		}
		if cfg.Hub.Name == "" {
			return fmt.Errorf("hub.name is required when hub is configured")
		}
		if cfg.Hub.Token == "" && cfg.Hub.TokenEnvVar == "" {
			return fmt.Errorf("hub.token or hub.token_env_var required when hub is configured")
		}
	}

	return nil
}

// LogDeprecations logs warnings for any deprecated config fields that are set
// to non-default values. Call this after the logger is fully configured.
func (c *Config) LogDeprecations(log *slog.Logger) {
	if c.Tmux.SocketName != "" {
		log.Warn("config key tmux.socket_name is deprecated and has no effect; remove it from your config")
	}
	if c.Ttyd.Enabled {
		log.Warn("config key ttyd.enabled is deprecated and has no effect; remove it from your config")
	}
	if c.Ttyd.BasePort != 0 {
		log.Warn("config key ttyd.base_port is deprecated and has no effect; remove it from your config")
	}
	if c.Ttyd.MaxPorts != 0 {
		log.Warn("config key ttyd.max_ports is deprecated and has no effect; remove it from your config")
	}
	if c.Ttyd.BindAddress != "" {
		log.Warn("config key ttyd.bind_address is deprecated and has no effect; remove it from your config")
	}
	if c.Ttyd.AdvertiseAddress != "" {
		log.Warn("config key ttyd.advertise_address is deprecated and has no effect; remove it from your config")
	}
}

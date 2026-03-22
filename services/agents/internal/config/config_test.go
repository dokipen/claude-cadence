package config

import (
	"os"
	"testing"
	"time"
)

func validProfiles() map[string]Profile {
	return map[string]Profile{"test": {Command: "echo test"}}
}

func validCleanup() CleanupConfig {
	return CleanupConfig{
		StaleSessionTTL: time.Hour,
		ReapInterval:    30 * time.Second,
	}
}

func TestValidate_ZeroStaleSessionTTL(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  CleanupConfig{StaleSessionTTL: 0, ReapInterval: 30 * time.Second},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for zero stale_session_ttl")
	}
}

func TestValidate_ValidLocalhostNoAuth(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidLocalhostIPv6(t *testing.T) {
	cfg := &Config{
		Host:     "::1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidTokenAuth(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "token", Token: "mysecret"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidTokenAuthWithEnvVar(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "token", TokenEnvVar: "AGENTD_TOKEN"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_TokenAuthWithoutToken(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "token"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for token auth without token value")
	}
	want := "token or token_env_var required for token authentication"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_InvalidAuthMode(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "invalid"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for invalid auth mode")
	}
}

func TestValidate_NonLocalhostWithTokenAuth(t *testing.T) {
	cfg := &Config{
		Host:     "0.0.0.0",
		Auth:     AuthConfig{Mode: "token", Token: "secret"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_NonLocalhostWithoutAuth(t *testing.T) {
	cfg := &Config{
		Host:     "0.0.0.0",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
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

func TestResolveToken_ReturnsTokenWhenNoEnvVar(t *testing.T) {
	a := &AuthConfig{Token: "hardcoded"}
	if got := a.ResolveToken(); got != "hardcoded" {
		t.Errorf("expected %q, got %q", "hardcoded", got)
	}
}

func TestResolveToken_ReturnsEnvVarWhenSet(t *testing.T) {
	t.Setenv("TEST_AGENT_TOKEN", "fromenv")
	a := &AuthConfig{Token: "hardcoded", TokenEnvVar: "TEST_AGENT_TOKEN"}
	if got := a.ResolveToken(); got != "fromenv" {
		t.Errorf("expected %q, got %q", "fromenv", got)
	}
}

func TestResolveToken_FallsBackToTokenWhenEnvVarEmpty(t *testing.T) {
	t.Setenv("TEST_AGENT_TOKEN", "")
	_ = os.Setenv("TEST_AGENT_TOKEN", "")
	a := &AuthConfig{Token: "fallback", TokenEnvVar: "TEST_AGENT_TOKEN"}
	if got := a.ResolveToken(); got != "fallback" {
		t.Errorf("expected %q, got %q", "fallback", got)
	}
}

// --- HubConfig validation ---

func TestValidate_Hub_Valid_WithToken(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		Hub: &HubConfig{
			URL:               "wss://hub.example.com/ws/agent",
			Name:              "test-agent",
			Token:             "secret",
			ReconnectInterval: 5 * time.Second,
		},
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_Hub_Valid_WithTokenEnvVar(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		Hub: &HubConfig{
			URL:               "wss://hub.example.com/ws/agent",
			Name:              "test-agent",
			TokenEnvVar:       "HUB_AGENT_TOKEN",
			ReconnectInterval: 5 * time.Second,
		},
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_Hub_MissingURL(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		Hub: &HubConfig{
			Name:              "test-agent",
			Token:             "secret",
			ReconnectInterval: 5 * time.Second,
		},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for missing hub.url")
	}
	want := "hub.url is required when hub is configured"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_Hub_MissingName(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		Hub: &HubConfig{
			URL:               "wss://hub.example.com/ws/agent",
			Token:             "secret",
			ReconnectInterval: 5 * time.Second,
		},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for missing hub.name")
	}
	want := "hub.name is required when hub is configured"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_Hub_MissingToken(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		Hub: &HubConfig{
			URL:               "wss://hub.example.com/ws/agent",
			Name:              "test-agent",
			ReconnectInterval: 5 * time.Second,
		},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for missing hub token")
	}
	want := "hub.token or hub.token_env_var required when hub is configured"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestApplyDefaults_Hub_ReconnectInterval(t *testing.T) {
	cfg := &Config{Hub: &HubConfig{}}
	applyDefaults(cfg)
	if cfg.Hub.RawReconnect != "5s" {
		t.Errorf("expected default reconnect_interval %q, got %q", "5s", cfg.Hub.RawReconnect)
	}
}

func TestHubResolveToken_ReturnsTokenWhenNoEnvVar(t *testing.T) {
	h := &HubConfig{Token: "hardcoded"}
	if got := h.ResolveToken(); got != "hardcoded" {
		t.Errorf("expected %q, got %q", "hardcoded", got)
	}
}

func TestHubResolveToken_ReturnsEnvVarWhenSet(t *testing.T) {
	t.Setenv("TEST_HUB_TOKEN", "fromenv")
	h := &HubConfig{Token: "hardcoded", TokenEnvVar: "TEST_HUB_TOKEN"}
	if got := h.ResolveToken(); got != "fromenv" {
		t.Errorf("expected %q, got %q", "fromenv", got)
	}
}

func TestHubResolveToken_FallsBackToTokenWhenEnvVarEmpty(t *testing.T) {
	t.Setenv("TEST_HUB_TOKEN", "")
	h := &HubConfig{Token: "fallback", TokenEnvVar: "TEST_HUB_TOKEN"}
	if got := h.ResolveToken(); got != "fallback" {
		t.Errorf("expected %q, got %q", "fallback", got)
	}
}

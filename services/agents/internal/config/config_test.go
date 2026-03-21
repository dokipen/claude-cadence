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

func TestApplyDefaults_AdvertiseAddressEmptyWhenTtydDisabled(t *testing.T) {
	cfg := &Config{}
	applyDefaults(cfg)
	if cfg.Ttyd.AdvertiseAddress != "" {
		t.Errorf("expected empty AdvertiseAddress when ttyd disabled, got %q", cfg.Ttyd.AdvertiseAddress)
	}
}

func TestApplyDefaults_AdvertiseAddressSetWhenTtydEnabled(t *testing.T) {
	cfg := &Config{Ttyd: TtydConfig{Enabled: true}}
	applyDefaults(cfg)
	if cfg.Ttyd.AdvertiseAddress != "127.0.0.1" {
		t.Errorf("expected AdvertiseAddress %q when ttyd enabled, got %q", "127.0.0.1", cfg.Ttyd.AdvertiseAddress)
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

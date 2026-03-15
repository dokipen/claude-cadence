package config

import (
	"os"
	"testing"
)

func validProfiles() map[string]Profile {
	return map[string]Profile{"test": {Command: "echo test"}}
}

func TestValidate_ValidLocalhostNoTLS(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
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
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_NonLocalhostWithoutTLS(t *testing.T) {
	cfg := &Config{
		Host:     "0.0.0.0",
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for non-localhost without TLS")
	}
	want := "TLS required for non-localhost bindings"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_TokenAuthWithoutTLS(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "token", Token: "secret"},
		Profiles: validProfiles(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for token auth without TLS")
	}
	want := "TLS required for token authentication"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_MTLSWithoutTLS(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		Auth:     AuthConfig{Mode: "mtls"},
		Profiles: validProfiles(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for mTLS without TLS")
	}
	want := "TLS required for mTLS authentication"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_TokenAuthWithoutToken(t *testing.T) {
	cfg := &Config{
		Host: "127.0.0.1",
		TLS:  TLSConfig{Enabled: true, CertFile: "cert.pem", KeyFile: "key.pem"},
		Auth: AuthConfig{Mode: "token"},
		// No Token, no TokenEnvVar
		Profiles: validProfiles(),
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
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for invalid auth mode")
	}
	want := "invalid auth mode"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_TLSEnabledWithoutCert(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		TLS:      TLSConfig{Enabled: true, CertFile: "", KeyFile: "key.pem"},
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for TLS enabled without cert_file")
	}
	want := "cert_file and key_file required when TLS is enabled"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_TLSEnabledWithoutKey(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		TLS:      TLSConfig{Enabled: true, CertFile: "cert.pem", KeyFile: ""},
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for TLS enabled without key_file")
	}
	want := "cert_file and key_file required when TLS is enabled"
	if err.Error() != want {
		t.Errorf("expected %q, got %q", want, err.Error())
	}
}

func TestValidate_ValidTLSWithTokenAuth(t *testing.T) {
	cfg := &Config{
		Host:     "127.0.0.1",
		TLS:      TLSConfig{Enabled: true, CertFile: "cert.pem", KeyFile: "key.pem"},
		Auth:     AuthConfig{Mode: "token", Token: "mysecret"},
		Profiles: validProfiles(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
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
	// Ensure the env var is actually empty (not unset) for the test.
	_ = os.Setenv("TEST_AGENT_TOKEN", "")
	a := &AuthConfig{Token: "fallback", TokenEnvVar: "TEST_AGENT_TOKEN"}
	if got := a.ResolveToken(); got != "fallback" {
		t.Errorf("expected %q, got %q", "fallback", got)
	}
}

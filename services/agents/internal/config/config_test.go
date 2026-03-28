package config

import (
	"os"
	"strings"
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

func validPTY() PTYConfig {
	return PTYConfig{WebSocketScheme: "ws"}
}

func TestValidate_ZeroStaleSessionTTL(t *testing.T) {
	cfg := &Config{
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidLocalhostIPv6(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidTokenAuth(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "token", Token: "mysecret"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_ValidTokenAuthWithEnvVar(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "token", TokenEnvVar: "AGENTD_TOKEN"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestValidate_TokenAuthWithoutToken(t *testing.T) {
	cfg := &Config{
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
		Auth:     AuthConfig{Mode: "invalid"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for invalid auth mode")
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
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
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
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

func TestValidate_PTY_WebSocketScheme_Invalid(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      PTYConfig{WebSocketScheme: "ftp"},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for invalid websocket_scheme")
	}
}

func TestValidate_PTY_WebSocketScheme_WSS(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      PTYConfig{WebSocketScheme: "wss"},
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error for wss scheme, got: %v", err)
	}
}

func TestHubResolveToken_FallsBackToTokenWhenEnvVarEmpty(t *testing.T) {
	t.Setenv("TEST_HUB_TOKEN", "")
	h := &HubConfig{Token: "fallback", TokenEnvVar: "TEST_HUB_TOKEN"}
	if got := h.ResolveToken(); got != "fallback" {
		t.Errorf("expected %q, got %q", "fallback", got)
	}
}

// --- TtydConfig.AdvertiseAddress validation ---

func advertiseAddressCfg(addr string) *Config {
	return &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      validPTY(),
		Ttyd:     TtydConfig{AdvertiseAddress: addr},
	}
}

func TestValidate_AdvertiseAddressValidBareHost(t *testing.T) {
	if err := validate(advertiseAddressCfg("example.com")); err != nil {
		t.Errorf("expected no error for bare host advertise_address, got: %v", err)
	}
}

func TestValidate_AdvertiseAddressValidHostPort(t *testing.T) {
	if err := validate(advertiseAddressCfg("example.com:8080")); err != nil {
		t.Errorf("expected no error for host:port advertise_address, got: %v", err)
	}
}

func TestValidate_AdvertiseAddressPathInjection(t *testing.T) {
	err := validate(advertiseAddressCfg("example.com/path"))
	if err == nil {
		t.Fatal("expected error for advertise_address with path component")
	}
	if !strings.Contains(err.Error(), "ttyd.advertise_address") {
		t.Errorf("expected error to contain %q, got %q", "ttyd.advertise_address", err.Error())
	}
}

func TestValidate_AdvertiseAddressQueryInjection(t *testing.T) {
	err := validate(advertiseAddressCfg("example.com?query=1"))
	if err == nil {
		t.Fatal("expected error for advertise_address with query component")
	}
	if !strings.Contains(err.Error(), "ttyd.advertise_address") {
		t.Errorf("expected error to contain %q, got %q", "ttyd.advertise_address", err.Error())
	}
}

func TestValidate_AdvertiseAddressFragmentInjection(t *testing.T) {
	err := validate(advertiseAddressCfg("example.com#fragment"))
	if err == nil {
		t.Fatal("expected error for advertise_address with fragment component")
	}
	if !strings.Contains(err.Error(), "ttyd.advertise_address") {
		t.Errorf("expected error to contain %q, got %q", "ttyd.advertise_address", err.Error())
	}
}

func TestValidate_AdvertiseAddressUserinfoInjection(t *testing.T) {
	err := validate(advertiseAddressCfg("attacker.com@legit.internal:8080"))
	if err == nil {
		t.Fatal("expected error for advertise_address with userinfo component")
	}
	if !strings.Contains(err.Error(), "ttyd.advertise_address") {
		t.Errorf("expected error to contain %q, got %q", "ttyd.advertise_address", err.Error())
	}
}

func TestValidate_AdvertiseAddressEmptyAllowed(t *testing.T) {
	if err := validate(advertiseAddressCfg("")); err != nil {
		t.Errorf("expected no error for empty advertise_address, got: %v", err)
	}
}

func TestPTYConfig_Validate_NegativeMaxSessions(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      PTYConfig{WebSocketScheme: "ws", MaxSessions: -1},
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for negative MaxSessions")
	}
	want := "pty.max_sessions must be >= 0 (0 means unlimited)"
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

func TestCleanupConfig_Validate_NegativeCreatingSessionTTL(t *testing.T) {
	cfg := &Config{
		Auth:    AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup: CleanupConfig{
			StaleSessionTTL:    time.Hour,
			ReapInterval:       30 * time.Second,
			CreatingSessionTTL: -1,
		},
		PTY: validPTY(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for negative CreatingSessionTTL")
	}
	want := "cleanup.creating_session_ttl must be >= 0 (0 means disabled)"
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

func TestCleanupConfig_Validate_NegativeErrorSessionTTL(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup: CleanupConfig{
			StaleSessionTTL: time.Hour,
			ReapInterval:    30 * time.Second,
			ErrorSessionTTL: -1,
		},
		PTY: validPTY(),
	}
	err := validate(cfg)
	if err == nil {
		t.Fatal("expected error for negative ErrorSessionTTL")
	}
	want := "cleanup.error_session_ttl must be >= 0 (0 means disabled)"
	if err.Error() != want {
		t.Errorf("error = %q, want %q", err.Error(), want)
	}
}

func TestPTYConfig_Validate_ZeroMaxSessions(t *testing.T) {
	cfg := &Config{
		Auth:     AuthConfig{Mode: "none"},
		Profiles: validProfiles(),
		Cleanup:  validCleanup(),
		PTY:      PTYConfig{WebSocketScheme: "ws", MaxSessions: 0},
	}
	if err := validate(cfg); err != nil {
		t.Errorf("expected no error for MaxSessions=0 (unlimited), got: %v", err)
	}
}

// --- Profile.Type tests ---

func writeConfigFile(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp("", "agentd-config-*.yaml")
	if err != nil {
		t.Fatalf("creating temp config file: %v", err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("writing temp config file: %v", err)
	}
	f.Close()
	t.Cleanup(func() { os.Remove(f.Name()) })
	return f.Name()
}

func TestProfileType_DefaultsToAgent(t *testing.T) {
	yaml := `
profiles:
  myprofile:
    command: echo test
auth:
  mode: none
cleanup:
  stale_session_ttl: 1h
  session_reap_interval: 30s
pty:
  websocket_scheme: ws
`
	path := writeConfigFile(t, yaml)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got := cfg.Profiles["myprofile"].Type; got != "agent" {
		t.Errorf("expected default Type %q, got %q", "agent", got)
	}
}

func TestProfileType_ShellIsValid(t *testing.T) {
	yaml := `
profiles:
  shellprofile:
    command: echo test
    type: shell
auth:
  mode: none
cleanup:
  stale_session_ttl: 1h
  session_reap_interval: 30s
pty:
  websocket_scheme: ws
`
	path := writeConfigFile(t, yaml)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got := cfg.Profiles["shellprofile"].Type; got != "shell" {
		t.Errorf("expected Type %q, got %q", "shell", got)
	}
}

func TestProfileType_AgentIsExplicit(t *testing.T) {
	yaml := `
profiles:
  agentprofile:
    command: echo test
    type: agent
auth:
  mode: none
cleanup:
  stale_session_ttl: 1h
  session_reap_interval: 30s
pty:
  websocket_scheme: ws
`
	path := writeConfigFile(t, yaml)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got := cfg.Profiles["agentprofile"].Type; got != "agent" {
		t.Errorf("expected Type %q, got %q", "agent", got)
	}
}

func TestProfileType_InvalidTypeRejected(t *testing.T) {
	yaml := `
profiles:
  badprofile:
    command: echo test
    type: invalid
auth:
  mode: none
cleanup:
  stale_session_ttl: 1h
  session_reap_interval: 30s
pty:
  websocket_scheme: ws
`
	path := writeConfigFile(t, yaml)
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid profile type")
	}
	if !strings.Contains(err.Error(), "badprofile") {
		t.Errorf("expected error to mention profile name %q, got %q", "badprofile", err.Error())
	}
	if !strings.Contains(err.Error(), "invalid") {
		t.Errorf("expected error to mention invalid value, got %q", err.Error())
	}
}

package rest

import (
	"net/http"
	"testing"

	"github.com/dokipen/claude-cadence/services/agent-hub/internal/hub"
)

func TestRpcCodeToHTTPStatus(t *testing.T) {
	tests := []struct {
		rpcCode    int
		httpStatus int
	}{
		{hub.RPCErrNotFound, http.StatusNotFound},
		{hub.RPCErrAlreadyExists, http.StatusConflict},
		{hub.RPCErrInvalidArgument, http.StatusBadRequest},
		{hub.RPCErrFailedPrecondition, http.StatusConflict},
		{hub.RPCErrInternal, http.StatusInternalServerError},
		{-99999, http.StatusInternalServerError},
	}

	for _, tt := range tests {
		got := rpcCodeToHTTPStatus(tt.rpcCode)
		if got != tt.httpStatus {
			t.Errorf("rpcCodeToHTTPStatus(%d): expected %d, got %d", tt.rpcCode, tt.httpStatus, got)
		}
	}
}

func TestNormalizeRepoFilter(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://github.com/owner/repo", "owner/repo"},
		{"https://github.com/owner/repo.git", "owner/repo"},
		{"http://github.com/owner/repo", "owner/repo"},
		// SSH remotes are rejected by ValidateProfileRepo at registration; no
		// stored profile can carry a git@ URL, so SSH normalization is not needed.
		// The input passes through lowercased with .git stripped.
		{"git@github.com:owner/repo.git", "git@github.com:owner/repo"},
		{"https://gitlab.com/owner/repo.git", "https://gitlab.com/owner/repo"},
		{"HTTPS://GITHUB.COM/Owner/Repo", "owner/repo"},
		{"", ""},
	}

	for _, tt := range tests {
		got := normalizeRepoFilter(tt.input)
		if got != tt.want {
			t.Errorf("normalizeRepoFilter(%q): expected %q, got %q", tt.input, tt.want, got)
		}
	}
}

func TestFilterAgentsByRepo(t *testing.T) {
	agents := []hub.AgentInfo{
		{
			Name: "alpha",
			Profiles: map[string]hub.ProfileInfo{
				"match":   {Description: "matches repo", Repo: "https://github.com/owner/repo"},
				"nomatch": {Description: "different repo", Repo: "https://github.com/other/repo"},
				"generic": {Description: "generic profile", Repo: ""},
			},
		},
		{
			Name: "beta",
			Profiles: map[string]hub.ProfileInfo{
				"nomatch": {Description: "different repo", Repo: "https://github.com/other/repo"},
			},
		},
		{
			Name:     "gamma",
			Profiles: map[string]hub.ProfileInfo{},
		},
	}

	t.Run("profiles matching repo are kept", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept")
		}
	})

	t.Run("profiles not matching are removed", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["nomatch"]; ok {
			t.Error("expected 'nomatch' profile to be removed")
		}
	})

	t.Run("profiles with empty Repo are always kept", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["generic"]; !ok {
			t.Error("expected generic profile with empty Repo to be kept")
		}
	})

	t.Run("agent with no matching profiles appears with empty profiles map", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		betaProfiles := result[1].Profiles
		if len(betaProfiles) != 0 {
			t.Errorf("expected empty profiles map for beta, got %d profiles", len(betaProfiles))
		}
	})

	t.Run("multiple agents filtered correctly", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "owner/repo")
		if len(result) != 3 {
			t.Errorf("expected 3 agents in result, got %d", len(result))
		}
		if result[0].Name != "alpha" {
			t.Errorf("expected first agent to be 'alpha', got %q", result[0].Name)
		}
		if result[1].Name != "beta" {
			t.Errorf("expected second agent to be 'beta', got %q", result[1].Name)
		}
	})

	t.Run("no-op when no profiles match: agent still present with empty profiles", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "no/match/at/all")
		// alpha has one generic profile (empty Repo), so it keeps that
		// beta has no generic profiles, so empty
		// gamma already empty
		betaProfiles := result[1].Profiles
		if len(betaProfiles) != 0 {
			t.Errorf("expected 0 profiles for beta with no match, got %d", len(betaProfiles))
		}
		if result[1].Name != "beta" {
			t.Errorf("expected beta to still be present")
		}
	})

	t.Run("originals are not mutated", func(t *testing.T) {
		_ = filterAgentsByRepo(agents, "owner/repo")
		if len(agents[0].Profiles) != 3 {
			t.Errorf("original alpha profiles were mutated: expected 3, got %d", len(agents[0].Profiles))
		}
	})

	t.Run("normalization applied to repo param", func(t *testing.T) {
		result := filterAgentsByRepo(agents, "https://github.com/owner/repo.git")
		alphaProfiles := result[0].Profiles
		if _, ok := alphaProfiles["match"]; !ok {
			t.Error("expected 'match' profile to be kept when repo param uses full HTTPS URL")
		}
	})
}

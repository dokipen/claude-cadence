package e2e_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	agentsv1 "github.com/dokipen/claude-cadence/services/agents/gen/agents/v1"
	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/server"
	"github.com/dokipen/claude-cadence/services/agents/internal/service"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
	"github.com/dokipen/claude-cadence/services/agents/internal/tmux"
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// fakeVaultServer creates a test HTTP server that mimics Vault's KV v2 API.
func fakeVaultServer(t *testing.T, secrets map[string]map[string]interface{}, expectedToken string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check token auth.
		if expectedToken != "" {
			if r.Header.Get("X-Vault-Token") != expectedToken {
				w.WriteHeader(http.StatusForbidden)
				fmt.Fprintf(w, `{"errors":["permission denied"]}`)
				return
			}
		}

		// Handle AppRole login.
		if r.URL.Path == "/v1/auth/approle/login" && r.Method == "POST" {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"auth": map[string]interface{}{
					"client_token": expectedToken,
				},
			})
			return
		}

		// Handle secret reads — strip /v1/ prefix to get the path.
		path := strings.TrimPrefix(r.URL.Path, "/v1/")
		data, ok := secrets[path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprintf(w, `{"errors":["secret not found"]}`)
			return
		}

		// Return KV v2 format.
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{
				"data": data,
			},
		})
	}))
}

// vaultTestEnv holds a server wired with vault and git clients.
type vaultTestEnv struct {
	addr        string
	srv         *server.Server
	bareRepo    string
	rootDir     string
	socketName  string
	vaultServer *httptest.Server
}

func setupVaultTestEnv(t *testing.T, secrets map[string]map[string]interface{}, vaultToken string) *vaultTestEnv {
	t.Helper()

	tmpDir := t.TempDir()
	bareRepo := filepath.Join(tmpDir, "remote.git")
	rootDir := filepath.Join(tmpDir, "agentd-data")

	// Create a bare repo with an initial commit.
	if err := os.MkdirAll(bareRepo, 0o755); err != nil {
		t.Fatalf("mkdir bare repo: %v", err)
	}
	run(t, "git", "init", "--bare", bareRepo)

	workCopy := filepath.Join(tmpDir, "work")
	run(t, "git", "clone", bareRepo, workCopy)
	run(t, "git", "-C", workCopy, "checkout", "-b", "main")
	if err := os.WriteFile(filepath.Join(workCopy, "README.md"), []byte("# test repo\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	run(t, "git", "-C", workCopy, "add", ".")
	run(t, "git", "-C", workCopy, "-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-m", "initial commit")
	run(t, "git", "-C", workCopy, "push", "-u", "origin", "main")
	run(t, "git", "-C", bareRepo, "symbolic-ref", "HEAD", "refs/heads/main")

	// Start fake Vault server.
	vs := fakeVaultServer(t, secrets, vaultToken)
	t.Cleanup(vs.Close)

	// Create Vault client.
	vaultCfg := &config.VaultConfig{
		Address:    vs.URL,
		AuthMethod: "token",
		Token:      vaultToken,
	}
	vaultClient, err := vault.NewClient(vaultCfg)
	if err != nil {
		t.Fatalf("creating vault client: %v", err)
	}

	socketName := "agentd-vault-test"

	profiles := map[string]config.Profile{
		"vault-sleeper": {
			Repo:        bareRepo,
			Command:     "sleep 3600",
			VaultSecret: "secret/data/agentd/test-repo",
		},
		"no-vault-sleeper": {
			Repo:    bareRepo,
			Command: "sleep 3600",
		},
	}

	tmuxClient := tmux.NewClient(socketName)
	store := session.NewStore()
	gitClient := git.NewClient(rootDir)
	mgr := session.NewManager(store, tmuxClient, nil, gitClient, vaultClient, profiles)
	svc := service.NewAgentService(mgr)

	srv, err := server.New(svc, &config.Config{
		Host:       "127.0.0.1",
		Port:       0,
		Reflection: true,
		Auth:       config.AuthConfig{Mode: "none"},
	})
	if err != nil {
		t.Fatalf("creating vault test server: %v", err)
	}

	go func() {
		_ = srv.Start()
	}()

	t.Cleanup(func() {
		srv.Stop()
		out, err := exec.Command("tmux", "-L", socketName, "list-sessions", "-F", "#{session_name}").Output()
		if err == nil {
			for _, name := range splitLines(string(out)) {
				exec.Command("tmux", "-L", socketName, "kill-session", "-t", name).Run()
			}
		}
	})

	return &vaultTestEnv{
		addr:        srv.Addr(),
		srv:         srv,
		bareRepo:    bareRepo,
		rootDir:     rootDir,
		socketName:  socketName,
		vaultServer: vs,
	}
}

func (e *vaultTestEnv) newClient(t *testing.T) agentsv1.AgentServiceClient {
	t.Helper()
	conn, err := grpc.NewClient(e.addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("connecting to vault test server: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return agentsv1.NewAgentServiceClient(conn)
}

func TestVault_TokenAuth(t *testing.T) {
	vaultToken := "test-vault-token-123"
	secrets := map[string]map[string]interface{}{
		"secret/data/agentd/test-repo": {
			"token": "github-token-abc",
		},
	}

	env := setupVaultTestEnv(t, secrets, vaultToken)
	client := env.newClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	// Creating a session with a vault-enabled profile should succeed,
	// proving that token auth to Vault worked.
	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "vault-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetWorktreePath() == "" {
		t.Error("expected non-empty worktree_path")
	}
	if sess.GetState().String() != "SESSION_STATE_RUNNING" {
		t.Errorf("expected STATE_RUNNING, got %s", sess.GetState().String())
	}
}

func TestVault_EnvInjection(t *testing.T) {
	vaultToken := "test-vault-token-456"
	secrets := map[string]map[string]interface{}{
		"secret/data/agentd/test-repo": {
			"token":      "github-token-xyz",
			"api_key":    "secret-api-key-123",
			"db_password": "super-secret-pw",
		},
	}

	env := setupVaultTestEnv(t, secrets, vaultToken)
	client := env.newClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "vault-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	// Wait briefly for tmux session to be fully up.
	time.Sleep(500 * time.Millisecond)

	// Check that vault secrets were injected as env vars in the tmux session.
	// tmux show-environment returns KEY=VALUE lines.
	for _, envKey := range []string{"TOKEN", "API_KEY", "DB_PASSWORD"} {
		out, err := exec.Command("tmux", "-L", env.socketName, "show-environment", "-t", name, envKey).Output()
		if err != nil {
			t.Errorf("expected env var %s to be set, got error: %v", envKey, err)
			continue
		}
		line := strings.TrimSpace(string(out))
		if !strings.Contains(line, "=") {
			t.Errorf("expected %s=<value>, got %q", envKey, line)
		}
	}
}

func TestVault_NoSecret_PublicRepo(t *testing.T) {
	vaultToken := "test-vault-token-789"
	// No secrets configured for the path — this profile doesn't use vault_secret.
	secrets := map[string]map[string]interface{}{}

	env := setupVaultTestEnv(t, secrets, vaultToken)
	client := env.newClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	// Profile without vault_secret should work fine without any vault secrets.
	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "no-vault-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	sess := resp.GetSession()
	if sess.GetWorktreePath() == "" {
		t.Error("expected non-empty worktree_path")
	}
	if sess.GetState().String() != "SESSION_STATE_RUNNING" {
		t.Errorf("expected STATE_RUNNING, got %s", sess.GetState().String())
	}
}

func TestVault_SecretRetrieval(t *testing.T) {
	vaultToken := "test-vault-token-retrieval"
	secrets := map[string]map[string]interface{}{
		"secret/data/agentd/test-repo": {
			"token":   "github-pat-for-clone",
			"ssh_key": "fake-ssh-key-pem-data",
		},
	}

	env := setupVaultTestEnv(t, secrets, vaultToken)
	client := env.newClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	// Session creation succeeds, meaning vault secret was fetched and
	// used during the git clone operation (even though creds aren't needed
	// for local bare repos, the fetch-from-vault path is exercised).
	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "vault-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp.GetSession().GetId(),
			Force:     true,
		})
	})

	// Verify the worktree was created with repo content.
	readmePath := filepath.Join(resp.GetSession().GetWorktreePath(), "README.md")
	if _, err := os.Stat(readmePath); err != nil {
		t.Errorf("expected README.md in worktree: %v", err)
	}

	// Verify vault secrets are available as env vars.
	time.Sleep(500 * time.Millisecond)
	out, err := exec.Command("tmux", "-L", env.socketName, "show-environment", "-t", name, "TOKEN").Output()
	if err != nil {
		t.Fatalf("expected TOKEN env var to be set: %v", err)
	}
	if !strings.Contains(string(out), "github-pat-for-clone") {
		t.Errorf("expected TOKEN=github-pat-for-clone, got %q", string(out))
	}
}

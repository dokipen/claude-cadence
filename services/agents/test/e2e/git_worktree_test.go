package e2e_test

import (
	"context"
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
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// gitTestEnv holds a standalone server wired with a git.Client.
type gitTestEnv struct {
	addr      string
	srv       *server.Server
	bareRepo  string
	rootDir   string
	socketName string
}

// setupGitTestEnv creates a bare git repo, starts a server with git support,
// and returns a cleanup function.
func setupGitTestEnv(t *testing.T) *gitTestEnv {
	t.Helper()

	tmpDir := t.TempDir()
	bareRepo := filepath.Join(tmpDir, "remote.git")
	rootDir := filepath.Join(tmpDir, "agentd-data")

	// Create a bare repo with an initial commit so clone works.
	if err := os.MkdirAll(bareRepo, 0o755); err != nil {
		t.Fatalf("mkdir bare repo: %v", err)
	}
	run(t, "git", "init", "--bare", bareRepo)

	// Create a temp working copy, add a commit, push to the bare repo.
	workCopy := filepath.Join(tmpDir, "work")
	run(t, "git", "clone", bareRepo, workCopy)
	run(t, "git", "-C", workCopy, "checkout", "-b", "main")
	if err := os.WriteFile(filepath.Join(workCopy, "README.md"), []byte("# test repo\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	run(t, "git", "-C", workCopy, "add", ".")
	run(t, "git", "-C", workCopy, "-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-m", "initial commit")
	run(t, "git", "-C", workCopy, "push", "-u", "origin", "main")

	// Set HEAD to point to main in the bare repo.
	run(t, "git", "-C", bareRepo, "symbolic-ref", "HEAD", "refs/heads/main")

	socketName := "agentd-git-test"

	profiles := map[string]config.Profile{
		"git-sleeper": {
			Repo:    bareRepo,
			Command: "sleep 3600",
		},
	}

	tmuxClient := tmux.NewClient(socketName)
	store := session.NewStore()
	gitClient := git.NewClient(rootDir)
	mgr := session.NewManager(store, tmuxClient, nil, gitClient, profiles)
	svc := service.NewAgentService(mgr)

	gitTestCfg := &config.Config{
		Host:       "127.0.0.1",
		Port:       0,
		Reflection: true,
		Auth:       config.AuthConfig{Mode: "none"},
	}

	srv, err := server.New(svc, gitTestCfg)
	if err != nil {
		t.Fatalf("creating git test server: %v", err)
	}

	go func() {
		_ = srv.Start()
	}()

	t.Cleanup(func() {
		srv.Stop()
		// Kill any leftover tmux sessions.
		out, err := exec.Command("tmux", "-L", socketName, "list-sessions", "-F", "#{session_name}").Output()
		if err == nil {
			for _, name := range splitLines(string(out)) {
				exec.Command("tmux", "-L", socketName, "kill-session", "-t", name).Run()
			}
		}
	})

	return &gitTestEnv{
		addr:       srv.Addr(),
		srv:        srv,
		bareRepo:   bareRepo,
		rootDir:    rootDir,
		socketName: socketName,
	}
}

func (e *gitTestEnv) newClient(t *testing.T) agentsv1.AgentServiceClient {
	t.Helper()
	conn, err := grpc.NewClient(e.addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("connecting to git test server: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return agentsv1.NewAgentServiceClient(conn)
}

func TestGitClone_FirstSession(t *testing.T) {
	env := setupGitTestEnv(t)
	client := env.newClient(t)
	ctx := context.Background()
	name := uniqueSessionName(t)

	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
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

	// Verify session has worktree metadata.
	if sess.GetWorktreePath() == "" {
		t.Error("expected non-empty worktree_path")
	}
	if sess.GetRepoUrl() == "" {
		t.Error("expected non-empty repo_url")
	}
	if sess.GetBaseRef() != "main" {
		t.Errorf("expected base_ref %q, got %q", "main", sess.GetBaseRef())
	}

	// Verify the worktree directory exists and contains the repo files.
	readmePath := filepath.Join(sess.GetWorktreePath(), "README.md")
	if _, err := os.Stat(readmePath); err != nil {
		t.Errorf("expected README.md in worktree, got error: %v", err)
	}

	// Verify the clone directory was created.
	cloneDir := filepath.Join(env.rootDir, "repos", filepath.Base(env.bareRepo))
	// For bare repo paths, the "owner" won't parse as expected from a URL.
	// Instead, just check that repos/ directory has content.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries, err := os.ReadDir(reposDir)
	if err != nil {
		t.Fatalf("reading repos dir: %v", err)
	}
	if len(entries) == 0 {
		t.Error("expected repos/ to contain at least one entry after clone")
	}
	_ = cloneDir // Used for documentation; parseRepoURL handles path-based repos too.
}

func TestGitClone_SecondSession_ReusesClone(t *testing.T) {
	env := setupGitTestEnv(t)
	client := env.newClient(t)
	ctx := context.Background()

	// Create first session.
	name1 := uniqueSessionName(t)
	resp1, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp1.GetSession().GetId(),
			Force:     true,
		})
	})

	// Note the clone directory's mod time.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries1, _ := os.ReadDir(reposDir)

	// Create second session — should reuse the same clone.
	name2 := uniqueSessionName(t)
	resp2, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp2.GetSession().GetId(),
			Force:     true,
		})
	})

	// Verify both sessions got different worktree paths.
	wt1 := resp1.GetSession().GetWorktreePath()
	wt2 := resp2.GetSession().GetWorktreePath()
	if wt1 == wt2 {
		t.Errorf("expected different worktree paths, both got %q", wt1)
	}

	// Verify no additional clone directories were created.
	entries2, _ := os.ReadDir(reposDir)
	if len(entries2) != len(entries1) {
		t.Errorf("expected same number of repo entries (%d), got %d — second session should reuse clone", len(entries1), len(entries2))
	}
}

func TestGitWorktree_Isolation(t *testing.T) {
	env := setupGitTestEnv(t)
	client := env.newClient(t)
	ctx := context.Background()

	// Create a session with a worktree.
	name := uniqueSessionName(t)
	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
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

	worktreePath := resp.GetSession().GetWorktreePath()

	// Create a new file in the worktree.
	testFile := filepath.Join(worktreePath, "worktree-only.txt")
	if err := os.WriteFile(testFile, []byte("isolated change\n"), 0o644); err != nil {
		t.Fatalf("writing test file: %v", err)
	}

	// Verify the file does NOT exist in the main clone.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries, _ := os.ReadDir(reposDir)
	for _, ownerEntry := range entries {
		ownerPath := filepath.Join(reposDir, ownerEntry.Name())
		repoEntries, _ := os.ReadDir(ownerPath)
		for _, repoEntry := range repoEntries {
			clonePath := filepath.Join(ownerPath, repoEntry.Name())
			cloneFile := filepath.Join(clonePath, "worktree-only.txt")
			if _, err := os.Stat(cloneFile); err == nil {
				t.Errorf("worktree-only.txt should NOT exist in clone at %s", clonePath)
			}
		}
	}
}

func TestGitWorktree_CleanupOnDestroy(t *testing.T) {
	env := setupGitTestEnv(t)
	client := env.newClient(t)
	ctx := context.Background()

	name := uniqueSessionName(t)
	resp, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	worktreePath := resp.GetSession().GetWorktreePath()
	sessionID := resp.GetSession().GetId()

	// Verify worktree exists.
	if _, err := os.Stat(worktreePath); err != nil {
		t.Fatalf("worktree should exist before destroy: %v", err)
	}

	// Destroy the session.
	_, err = client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
		SessionId: sessionID,
		Force:     true,
	})
	if err != nil {
		t.Fatalf("DestroySession: %v", err)
	}

	// Verify worktree directory is removed.
	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Errorf("worktree directory should be removed after destroy, got err: %v", err)
	}

	// Verify tmux session is gone.
	if tmuxSessionExists(env.socketName, name) {
		t.Errorf("tmux session %q should be gone after destroy", name)
	}
}

func TestGitRepoUpdate_PullsLatest(t *testing.T) {
	env := setupGitTestEnv(t)
	client := env.newClient(t)
	ctx := context.Background()

	// Create first session to trigger initial clone.
	name1 := uniqueSessionName(t)
	resp1, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("CreateSession 1: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp1.GetSession().GetId(),
			Force:     true,
		})
	})

	// Push a new commit to the bare repo.
	workCopy := filepath.Join(filepath.Dir(env.bareRepo), "work")
	if err := os.WriteFile(filepath.Join(workCopy, "new-file.txt"), []byte("new content\n"), 0o644); err != nil {
		t.Fatalf("writing new file to work copy: %v", err)
	}
	run(t, "git", "-C", workCopy, "add", ".")
	run(t, "git", "-C", workCopy, "-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-m", "second commit")
	run(t, "git", "-C", workCopy, "push")

	// Create second session — should pull latest and have the new file.
	name2 := uniqueSessionName(t)
	resp2, err := client.CreateSession(ctx, &agentsv1.CreateSessionRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("CreateSession 2: %v", err)
	}
	t.Cleanup(func() {
		client.DestroySession(ctx, &agentsv1.DestroySessionRequest{
			SessionId: resp2.GetSession().GetId(),
			Force:     true,
		})
	})

	// Verify the new file exists in the second session's worktree.
	newFilePath := filepath.Join(resp2.GetSession().GetWorktreePath(), "new-file.txt")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(newFilePath); err == nil {
			return // success
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Errorf("expected new-file.txt in second worktree at %s", newFilePath)
}

// run executes a command and fails the test on error.
func run(t *testing.T, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v: %v: %s", name, args, err, string(output))
	}
}

// splitLines splits a string into non-empty lines.
func splitLines(s string) []string {
	var result []string
	for _, line := range strings.Split(strings.TrimSpace(s), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			result = append(result, line)
		}
	}
	return result
}

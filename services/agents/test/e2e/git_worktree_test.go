package e2e_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/git"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

// gitTestEnv holds a manager wired with a git.Client.
type gitTestEnv struct {
	mgr      *session.Manager
	bareRepo string
	rootDir  string
}

// setupGitTestEnv creates a bare git repo, creates a manager with git support,
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

	profiles := map[string]config.Profile{
		"git-sleeper": {
			Repo:    bareRepo,
			Command: "sleep 3600",
		},
	}

	ptyManager := pty.NewPTYManager(pty.PTYConfig{})
	store := session.NewStore()
	gitClient := git.NewClient(rootDir)
	mgr := session.NewManager(store, ptyManager, gitClient, nil, profiles, 0)

	return &gitTestEnv{
		mgr:      mgr,
		bareRepo: bareRepo,
		rootDir:  rootDir,
	}
}

func TestGitClone_FirstSession(t *testing.T) {
	env := setupGitTestEnv(t)
	name := uniqueSessionName(t)

	sess, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	t.Cleanup(func() {
		env.mgr.Destroy(sess.ID, true)
	})

	// worktree_path is no longer pre-created by agentd — agents create their own via /new-work.
	if sess.WorktreePath != "" {
		t.Errorf("expected empty worktree_path, got %q", sess.WorktreePath)
	}
	if sess.RepoURL == "" {
		t.Error("expected non-empty repo_url")
	}

	// Verify the clone directory was created and contains the repo files.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries, err := os.ReadDir(reposDir)
	if err != nil {
		t.Fatalf("reading repos dir: %v", err)
	}
	if len(entries) == 0 {
		t.Error("expected repos/ to contain at least one entry after clone")
	}

	// Find the clone dir and verify README.md is present.
	var readmeFound bool
	for _, ownerEntry := range entries {
		ownerPath := filepath.Join(reposDir, ownerEntry.Name())
		repoEntries, _ := os.ReadDir(ownerPath)
		for _, repoEntry := range repoEntries {
			readmePath := filepath.Join(ownerPath, repoEntry.Name(), "README.md")
			if _, err := os.Stat(readmePath); err == nil {
				readmeFound = true
			}
		}
	}
	if !readmeFound {
		t.Error("expected README.md in clone directory")
	}
}

func TestGitClone_SecondSession_ReusesClone(t *testing.T) {
	env := setupGitTestEnv(t)

	// Create first session.
	name1 := uniqueSessionName(t)
	sess1, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("Create 1: %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess1.ID, true)
	})

	// Note the clone directory's mod time.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries1, _ := os.ReadDir(reposDir)

	// Create second session — should reuse the same clone.
	name2 := uniqueSessionName(t)
	sess2, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("Create 2: %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess2.ID, true)
	})

	// Verify no additional clone directories were created.
	entries2, _ := os.ReadDir(reposDir)
	if len(entries2) != len(entries1) {
		t.Errorf("expected same number of repo entries (%d), got %d — second session should reuse clone", len(entries1), len(entries2))
	}
}

func TestGitRepoUpdate_PullsLatest(t *testing.T) {
	env := setupGitTestEnv(t)

	// Create first session to trigger initial clone.
	name1 := uniqueSessionName(t)
	sess1, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("Create 1: %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess1.ID, true)
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
	sess2, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("Create 2: %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess2.ID, true)
	})

	// Verify the new file exists in the clone directory (sessions start at clone root).
	reposDir := filepath.Join(env.rootDir, "repos")
	entries, _ := os.ReadDir(reposDir)
	var newFileFound bool
	for _, ownerEntry := range entries {
		ownerPath := filepath.Join(reposDir, ownerEntry.Name())
		repoEntries, _ := os.ReadDir(ownerPath)
		for _, repoEntry := range repoEntries {
			newFilePath := filepath.Join(ownerPath, repoEntry.Name(), "new-file.txt")
			if _, err := os.Stat(newFilePath); err == nil {
				newFileFound = true
			}
		}
	}
	if !newFileFound {
		t.Errorf("expected new-file.txt in clone directory after pull")
	}
}

func TestGitDetachedHead_RecoveredOnNextSession(t *testing.T) {
	env := setupGitTestEnv(t)

	// Create first session to trigger initial clone.
	name1 := uniqueSessionName(t)
	sess1, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name1,
	})
	if err != nil {
		t.Fatalf("Create 1: %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess1.ID, true)
	})

	// Detach HEAD in the clone root to simulate a session that ran
	// "git checkout <commit>" before calling /new-work.
	reposDir := filepath.Join(env.rootDir, "repos")
	entries, err := os.ReadDir(reposDir)
	if err != nil {
		t.Fatalf("reading repos dir: %v", err)
	}
	var cloneDir string
	for _, ownerEntry := range entries {
		ownerPath := filepath.Join(reposDir, ownerEntry.Name())
		repoEntries, _ := os.ReadDir(ownerPath)
		for _, repoEntry := range repoEntries {
			cloneDir = filepath.Join(ownerPath, repoEntry.Name())
		}
	}
	if cloneDir == "" {
		t.Fatal("could not find clone directory")
	}
	// Detach HEAD by checking out the current commit directly.
	run(t, "git", "-C", cloneDir, "checkout", "--detach", "HEAD")

	// Verify HEAD is detached.
	headOut, err := exec.Command("git", "-C", cloneDir, "symbolic-ref", "--quiet", "HEAD").Output()
	if err == nil {
		t.Fatalf("expected detached HEAD, but HEAD points to %s", strings.TrimSpace(string(headOut)))
	}

	// Creating a second session should recover from detached HEAD via pullDefaultBranch.
	name2 := uniqueSessionName(t)
	sess2, err := env.mgr.Create(session.CreateRequest{
		AgentProfile: "git-sleeper",
		SessionName:  name2,
	})
	if err != nil {
		t.Fatalf("Create 2 (after detached HEAD): %v", err)
	}
	t.Cleanup(func() {
		env.mgr.Destroy(sess2.ID, true)
	})

	// Verify HEAD is now attached to the default branch (main).
	headRef, err := exec.Command("git", "-C", cloneDir, "symbolic-ref", "HEAD").Output()
	if err != nil {
		t.Fatalf("expected HEAD to be attached after second session, but got error: %v", err)
	}
	ref := strings.TrimSpace(string(headRef))
	if ref != "refs/heads/main" {
		t.Errorf("expected HEAD to point to %q, got %q", "refs/heads/main", ref)
	}
}

// run executes a command and fails the test on error.
func run(t *testing.T, name string, args ...string) {
	t.Helper()
	cmd := exec.Command(name, args...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s %v: %v: %s", name, args, err, string(output))
	}
}

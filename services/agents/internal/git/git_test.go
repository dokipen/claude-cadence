package git

import (
	"os"
	"os/exec"
	"strings"
	"testing"
)

func newTestClient(t *testing.T) *Client {
	t.Helper()
	return NewClient(t.TempDir())
}

func TestApplyCredentials_NilCreds_SetsGITTERMINALPROMPT(t *testing.T) {
	c := newTestClient(t)
	cmd := exec.Command("git", "version")
	c.applyCredentials(cmd, "https://github.com/owner/repo.git", nil)

	found := false
	for _, e := range cmd.Env {
		if e == "GIT_TERMINAL_PROMPT=0" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected GIT_TERMINAL_PROMPT=0 in cmd.Env, got: %v", cmd.Env)
	}
}

func TestApplyCredentials_NilCreds_ReturnsNoopCleanup(t *testing.T) {
	c := newTestClient(t)
	cmd := exec.Command("git", "version")
	cleanup := c.applyCredentials(cmd, "https://github.com/owner/repo.git", nil)
	// Should not panic.
	cleanup()
}

func TestApplyCredentials_HTTPS_TokenSetsCredentialHelper(t *testing.T) {
	c := newTestClient(t)
	cmd := exec.Command("git", "version")
	creds := &Credentials{Token: "mytoken"}
	cleanup := c.applyCredentials(cmd, "https://github.com/owner/repo.git", creds)
	defer cleanup()

	env := cmd.Env
	hasKey := false
	hasValue := false
	hasCount := false
	credFile := ""

	for _, e := range env {
		if e == "GIT_CONFIG_KEY_0=credential.helper" {
			hasKey = true
		}
		if strings.HasPrefix(e, "GIT_CONFIG_VALUE_0=") && strings.Contains(e, "store --file=") {
			hasValue = true
			// Extract the file path for later verification.
			credFile = strings.TrimPrefix(e, "GIT_CONFIG_VALUE_0=store --file=")
		}
		if e == "GIT_CONFIG_COUNT=1" {
			hasCount = true
		}
	}

	if !hasKey {
		t.Errorf("expected GIT_CONFIG_KEY_0=credential.helper in env")
	}
	if !hasValue {
		t.Errorf("expected GIT_CONFIG_VALUE_0 containing 'store --file=' in env")
	}
	if !hasCount {
		t.Errorf("expected GIT_CONFIG_COUNT=1 in env")
	}

	// Temp file should exist before cleanup.
	if credFile != "" {
		if _, err := os.Stat(credFile); err != nil {
			t.Errorf("expected temp cred file %q to exist before cleanup", credFile)
		}
	}

	// After cleanup, temp file should be removed.
	cleanup()
	if credFile != "" {
		if _, err := os.Stat(credFile); err == nil {
			t.Errorf("expected temp cred file %q to be removed after cleanup", credFile)
		}
	}
}

func TestApplyCredentials_SSH_SetsSSHCommand(t *testing.T) {
	c := newTestClient(t)
	cmd := exec.Command("git", "version")
	creds := &Credentials{SSHKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n"}
	cleanup := c.applyCredentials(cmd, "git@github.com:owner/repo.git", creds)
	defer cleanup()

	keyFile := ""
	for _, e := range cmd.Env {
		if strings.HasPrefix(e, "GIT_SSH_COMMAND=ssh -i ") {
			// Extract key file path.
			rest := strings.TrimPrefix(e, "GIT_SSH_COMMAND=ssh -i ")
			keyFile = strings.SplitN(rest, " ", 2)[0]
			break
		}
	}

	if keyFile == "" {
		t.Errorf("expected GIT_SSH_COMMAND starting with 'ssh -i ' in env, got: %v", cmd.Env)
		return
	}

	// Temp key file should exist before cleanup.
	if _, err := os.Stat(keyFile); err != nil {
		t.Errorf("expected temp key file %q to exist before cleanup", keyFile)
	}

	// After cleanup, temp key file should be removed.
	cleanup()
	if _, err := os.Stat(keyFile); err == nil {
		t.Errorf("expected temp key file %q to be removed after cleanup", keyFile)
	}
}

func TestEnsureOnPath_PrependsMissingDir(t *testing.T) {
	env := []string{"PATH=/usr/bin:/bin", "HOME=/home/user"}
	result := ensureOnPath(env, "/opt/homebrew/bin")

	found := false
	for _, e := range result {
		if strings.HasPrefix(e, "PATH=") {
			val := strings.TrimPrefix(e, "PATH=")
			if strings.HasPrefix(val, "/opt/homebrew/bin"+string(os.PathListSeparator)) {
				found = true
			}
			break
		}
	}
	if !found {
		t.Errorf("expected /opt/homebrew/bin prepended to PATH, got: %v", result)
	}
}

func TestEnsureOnPath_NoSubstringFalsePositive(t *testing.T) {
	// "/usr/bin" must not be considered present when PATH only contains "/usr/bin/vendor_perl".
	env := []string{"PATH=/usr/bin/vendor_perl:/bin"}
	result := ensureOnPath(env, "/usr/bin")

	found := false
	for _, e := range result {
		if strings.HasPrefix(e, "PATH=") {
			val := strings.TrimPrefix(e, "PATH=")
			if strings.HasPrefix(val, "/usr/bin"+string(os.PathListSeparator)) {
				found = true
			}
			break
		}
	}
	if !found {
		t.Errorf("expected /usr/bin prepended to PATH (substring match must not prevent prepend), got: %v", result)
	}
}

func TestEnsureOnPath_SkipsExistingDir(t *testing.T) {
	env := []string{"PATH=/opt/homebrew/bin:/usr/bin:/bin"}
	result := ensureOnPath(env, "/opt/homebrew/bin")

	for _, e := range result {
		if strings.HasPrefix(e, "PATH=") {
			val := strings.TrimPrefix(e, "PATH=")
			count := strings.Count(val, "/opt/homebrew/bin")
			if count != 1 {
				t.Errorf("expected /opt/homebrew/bin to appear exactly once, got %d times in PATH=%s", count, val)
			}
			return
		}
	}
	t.Errorf("PATH not found in result: %v", result)
}

func TestRemoveWorktree_EmptyPath(t *testing.T) {
	c := newTestClient(t)
	if err := c.RemoveWorktree(""); err == nil {
		t.Error("expected error for empty path")
	}
}

func TestRemoveWorktree_NonExistentPath(t *testing.T) {
	c := newTestClient(t)
	// Should return nil (idempotent) when the path does not exist.
	if err := c.RemoveWorktree("/nonexistent/path/that/does/not/exist"); err != nil {
		t.Errorf("expected nil for non-existent path, got: %v", err)
	}
}

func TestRemoveWorktree_PathEscapesRootDir(t *testing.T) {
	c := newTestClient(t)
	// Create a real directory outside the client's rootDir to pass the os.Stat check.
	outside := t.TempDir()
	if err := c.RemoveWorktree(outside); err == nil {
		t.Error("expected error for path escaping rootDir")
	}
}

func TestRemoveWorktree_RemovesLinkedWorktree(t *testing.T) {
	tmpDir := t.TempDir()
	c := NewClient(tmpDir)

	// Create a bare repo to clone from.
	bareRepo := tmpDir + "/remote.git"
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command(args[0], args[1:]...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %v: %s", args, err, out)
		}
	}
	run("git", "init", "--bare", bareRepo)
	// Clone so we have a working repo with at least one commit.
	work := tmpDir + "/work"
	run("git", "clone", bareRepo, work)
	run("git", "-C", work, "config", "user.email", "test@test.com")
	run("git", "-C", work, "config", "user.name", "Test")
	run("git", "-C", work, "commit", "--allow-empty", "-m", "init")
	run("git", "-C", work, "push", "origin", "HEAD:main")

	// Clone via the git client (creates repos/<owner>/<repo>).
	cloneDir, err := c.EnsureClone(bareRepo, nil)
	if err != nil {
		t.Fatalf("EnsureClone: %v", err)
	}

	// Create a linked worktree inside rootDir.
	worktreePath := tmpDir + "/wt/feature"
	run("git", "-C", cloneDir, "worktree", "add", "-b", "feature", worktreePath)

	if _, err := os.Stat(worktreePath); err != nil {
		t.Fatalf("worktree should exist before RemoveWorktree: %v", err)
	}

	if err := c.RemoveWorktree(worktreePath); err != nil {
		t.Fatalf("RemoveWorktree: %v", err)
	}

	if _, err := os.Stat(worktreePath); !os.IsNotExist(err) {
		t.Errorf("expected worktree to be removed, got: %v", err)
	}
}

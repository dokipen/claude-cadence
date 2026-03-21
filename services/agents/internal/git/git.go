package git

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var (
	// refNameRe validates git ref names to prevent flag injection and traversal.
	refNameRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/-]*$`)
	// repoSegmentRe validates owner/repo path segments.
	repoSegmentRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)
)

// Credentials holds authentication data for git operations.
type Credentials struct {
	// Token is used for HTTPS repos via a credential helper.
	Token string
	// SSHKey is a PEM-encoded private key for SSH repos.
	SSHKey string
}

// Client wraps git CLI operations for repo cloning and worktree management.
type Client struct {
	rootDir   string
	cloneMu   sync.Map // keyed by clone path → *sync.Mutex
}

// NewClient creates a git client that stores repos and worktrees under rootDir.
func NewClient(rootDir string) *Client {
	return &Client{rootDir: rootDir}
}

// getCloneLock returns a per-path mutex for serializing clone operations.
func (c *Client) getCloneLock(clonePath string) *sync.Mutex {
	actual, _ := c.cloneMu.LoadOrStore(clonePath, &sync.Mutex{})
	return actual.(*sync.Mutex)
}

// EnsureClone clones the repo if it doesn't exist, or pulls the default branch
// if it does. Returns the path to the clone directory.
// If creds is non-nil, credentials are injected into the git environment.
func (c *Client) EnsureClone(repoURL string, creds *Credentials) (string, error) {
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		return "", fmt.Errorf("parsing repo URL: %w", err)
	}

	cloneDir := filepath.Join(c.rootDir, "repos", owner, repo)

	// Verify the resolved path is under rootDir to prevent traversal.
	absCloneDir, err := filepath.Abs(cloneDir)
	if err != nil {
		return "", fmt.Errorf("resolving clone path: %w", err)
	}
	absRootDir, err := filepath.Abs(c.rootDir)
	if err != nil {
		return "", fmt.Errorf("resolving root dir: %w", err)
	}
	if !strings.HasPrefix(absCloneDir, absRootDir+string(filepath.Separator)) {
		return "", fmt.Errorf("clone path %q escapes root dir %q", absCloneDir, absRootDir)
	}

	// Serialize clone/pull operations per repo path.
	mu := c.getCloneLock(absCloneDir)
	mu.Lock()
	defer mu.Unlock()

	if _, err := os.Stat(filepath.Join(cloneDir, ".git")); err == nil {
		// Already cloned — pull default branch.
		if err := c.pullDefaultBranch(cloneDir, creds); err != nil {
			return "", fmt.Errorf("pulling default branch: %w", err)
		}
		return cloneDir, nil
	}

	// Clone fresh.
	if err := os.MkdirAll(filepath.Dir(cloneDir), 0o755); err != nil {
		return "", fmt.Errorf("creating repo parent dir: %w", err)
	}

	cmd := exec.Command("git", "clone", repoURL, cloneDir)
	cleanup := c.applyCredentials(cmd, repoURL, creds)
	defer cleanup()
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git clone: %w: %s", err, string(output))
	}

	return cloneDir, nil
}

// DefaultBranch returns the default branch name for the repo at cloneDir.
func (c *Client) DefaultBranch(cloneDir string) (string, error) {
	cmd := exec.Command("git", "-C", cloneDir, "symbolic-ref", "refs/remotes/origin/HEAD")
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Fallback: try common names.
		for _, name := range []string{"main", "master"} {
			check := exec.Command("git", "-C", cloneDir, "rev-parse", "--verify", "refs/remotes/origin/"+name)
			if check.Run() == nil {
				return name, nil
			}
		}
		return "", fmt.Errorf("detecting default branch: %w: %s", err, string(output))
	}
	// Output is like "refs/remotes/origin/main"
	ref := strings.TrimSpace(string(output))
	parts := strings.Split(ref, "/")
	branch := parts[len(parts)-1]
	if !refNameRe.MatchString(branch) {
		return "", fmt.Errorf("detected branch name %q contains invalid characters", branch)
	}
	return branch, nil
}

// ValidateRef checks that a git ref name is safe to use in commands.
func ValidateRef(ref string) error {
	if ref == "" {
		return nil
	}
	if !refNameRe.MatchString(ref) {
		return fmt.Errorf("invalid ref name %q: must match %s", ref, refNameRe.String())
	}
	if strings.Contains(ref, "..") {
		return fmt.Errorf("invalid ref name %q: must not contain '..'", ref)
	}
	return nil
}

// CloneDir returns the standard clone path for a repo URL.
func (c *Client) CloneDir(repoURL string) (string, error) {
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		return "", err
	}
	return filepath.Join(c.rootDir, "repos", owner, repo), nil
}

func (c *Client) pullDefaultBranch(cloneDir string, creds *Credentials) error {
	branch, err := c.DefaultBranch(cloneDir)
	if err != nil {
		return err
	}

	// Fetch then update the local branch ref to match origin.
	fetch := exec.Command("git", "-C", cloneDir, "fetch", "origin", branch)
	// Determine repo URL for credential type detection.
	urlCmd := exec.Command("git", "-C", cloneDir, "remote", "get-url", "origin")
	var cleanup func()
	if urlOut, err := urlCmd.Output(); err == nil {
		cleanup = c.applyCredentials(fetch, strings.TrimSpace(string(urlOut)), creds)
	} else {
		cleanup = func() {}
	}
	output, err := fetch.CombinedOutput()
	cleanup()
	if err != nil {
		return fmt.Errorf("git fetch: %w: %s", err, string(output))
	}

	update := exec.Command("git", "-C", cloneDir, "update-ref", "refs/heads/"+branch, "refs/remotes/origin/"+branch)
	if output, err := update.CombinedOutput(); err != nil {
		return fmt.Errorf("git update-ref: %w: %s", err, string(output))
	}

	// Update the working tree so sessions starting in cloneDir see the latest
	// content. This runs under the per-clone mutex, but the mutex is released
	// before the tmux session starts. Concurrent sessions for the same repo
	// share this working tree; any uncommitted changes a session writes before
	// calling /new-work could be discarded by a subsequent pull. The workflow
	// contract (agents call /new-work immediately) keeps this window small.
	reset := exec.Command("git", "-C", cloneDir, "reset", "--hard", "refs/remotes/origin/"+branch)
	if output, err := reset.CombinedOutput(); err != nil {
		return fmt.Errorf("git reset: %w: %s", err, string(output))
	}

	return nil
}

// applyCredentials sets environment variables on a git command for authentication.
// Returns a cleanup function that removes any temporary credential files.
func (c *Client) applyCredentials(cmd *exec.Cmd, repoURL string, creds *Credentials) func() {
	noop := func() {}
	if creds == nil {
		return noop
	}

	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")

	var tempFiles []string

	if strings.HasPrefix(repoURL, "git@") || strings.Contains(repoURL, "ssh://") {
		// SSH repo — use SSH key via GIT_SSH_COMMAND with a temp key file.
		if creds.SSHKey != "" {
			keyFile, err := writeTempSecret(creds.SSHKey, "agentd-ssh-key-*")
			if err == nil {
				tempFiles = append(tempFiles, keyFile)
				cmd.Env = append(cmd.Env,
					fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new", keyFile),
				)
			}
		}
	} else {
		// HTTPS repo — use token via a git-credential-store temp file.
		if creds.Token != "" {
			credFile, err := writeGitCredentials(repoURL, creds.Token)
			if err == nil {
				tempFiles = append(tempFiles, credFile)
				cmd.Env = append(cmd.Env,
					"GIT_CONFIG_KEY_0=credential.helper",
					fmt.Sprintf("GIT_CONFIG_VALUE_0=store --file=%s", credFile),
					"GIT_CONFIG_COUNT=1",
				)
			}
		}
	}

	return func() {
		for _, f := range tempFiles {
			os.Remove(f)
		}
	}
}

// writeGitCredentials writes a git-credential-store formatted file for HTTPS auth.
// Format: https://username:token@hostname
func writeGitCredentials(repoURL, token string) (string, error) {
	u, err := url.Parse(repoURL)
	if err != nil {
		return "", fmt.Errorf("parsing repo URL for credentials: %w", err)
	}
	credLine := fmt.Sprintf("%s://x-access-token:%s@%s\n", u.Scheme, token, u.Host)
	return writeTempSecret(credLine, "agentd-git-cred-*")
}

// writeTempSecret writes sensitive data to a temp file with 0600 permissions.
func writeTempSecret(data, pattern string) (string, error) {
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(data); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	f.Close()
	if err := os.Chmod(f.Name(), 0o600); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// parseRepoURL extracts owner and repo from HTTPS, SSH, or local path git URLs.
func parseRepoURL(repoURL string) (owner, repo string, err error) {
	// Handle SSH format: git@github.com:owner/repo.git
	if strings.HasPrefix(repoURL, "git@") {
		parts := strings.SplitN(repoURL, ":", 2)
		if len(parts) != 2 {
			return "", "", fmt.Errorf("invalid SSH repo URL: %s", repoURL)
		}
		path := strings.TrimSuffix(parts[1], ".git")
		segments := strings.Split(path, "/")
		if len(segments) < 2 {
			return "", "", fmt.Errorf("invalid SSH repo URL path: %s", repoURL)
		}
		owner, repo = segments[len(segments)-2], segments[len(segments)-1]
		return validateRepoSegments(owner, repo)
	}

	// Handle HTTPS format: https://github.com/owner/repo.git
	if strings.HasPrefix(repoURL, "https://") || strings.HasPrefix(repoURL, "http://") {
		u, err := url.Parse(repoURL)
		if err != nil {
			return "", "", fmt.Errorf("parsing URL: %w", err)
		}
		path := strings.TrimSuffix(strings.TrimPrefix(u.Path, "/"), ".git")
		segments := strings.Split(path, "/")
		if len(segments) < 2 {
			return "", "", fmt.Errorf("invalid HTTPS repo URL path: %s", repoURL)
		}
		owner, repo = segments[len(segments)-2], segments[len(segments)-1]
		return validateRepoSegments(owner, repo)
	}

	// Handle local path (for testing): /path/to/repo.git
	if filepath.IsAbs(repoURL) {
		dir := strings.TrimSuffix(filepath.Base(repoURL), ".git")
		parent := filepath.Base(filepath.Dir(repoURL))
		if dir == "" || parent == "" {
			return "", "", fmt.Errorf("invalid local repo path: %s", repoURL)
		}
		return validateRepoSegments(parent, dir)
	}

	return "", "", fmt.Errorf("unsupported repo URL scheme: %s", repoURL)
}

func validateRepoSegments(owner, repo string) (string, string, error) {
	if !repoSegmentRe.MatchString(owner) {
		return "", "", fmt.Errorf("invalid repo owner %q: must match %s", owner, repoSegmentRe.String())
	}
	if !repoSegmentRe.MatchString(repo) {
		return "", "", fmt.Errorf("invalid repo name %q: must match %s", repo, repoSegmentRe.String())
	}
	return owner, repo, nil
}

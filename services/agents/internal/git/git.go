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
func (c *Client) EnsureClone(repoURL string) (string, error) {
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
		if err := c.pullDefaultBranch(cloneDir); err != nil {
			return "", fmt.Errorf("pulling default branch: %w", err)
		}
		return cloneDir, nil
	}

	// Clone fresh.
	if err := os.MkdirAll(filepath.Dir(cloneDir), 0o755); err != nil {
		return "", fmt.Errorf("creating repo parent dir: %w", err)
	}

	cmd := exec.Command("git", "clone", repoURL, cloneDir)
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

// AddWorktree creates a new worktree at worktreeDir based on baseRef.
// If baseRef is empty, uses the default branch.
// Returns the resolved baseRef.
func (c *Client) AddWorktree(cloneDir, worktreeDir, baseRef string) (string, error) {
	if baseRef == "" {
		branch, err := c.DefaultBranch(cloneDir)
		if err != nil {
			return "", err
		}
		baseRef = branch
	}

	cmd := exec.Command("git", "-C", cloneDir, "worktree", "add", "--detach", worktreeDir, "origin/"+baseRef)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("git worktree add: %w: %s", err, string(output))
	}
	return baseRef, nil
}

// RemoveWorktree removes a worktree directory and its git bookkeeping.
func (c *Client) RemoveWorktree(cloneDir, worktreeDir string) error {
	cmd := exec.Command("git", "-C", cloneDir, "worktree", "remove", "--force", worktreeDir)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree remove: %w: %s", err, string(output))
	}
	return nil
}

// PruneWorktrees removes stale worktree references.
func (c *Client) PruneWorktrees(cloneDir string) error {
	cmd := exec.Command("git", "-C", cloneDir, "worktree", "prune")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree prune: %w: %s", err, string(output))
	}
	return nil
}

// WorktreeDir returns the standard worktree path for a session UUID.
func (c *Client) WorktreeDir(sessionID string) string {
	return filepath.Join(c.rootDir, "worktrees", sessionID)
}

// CloneDir returns the standard clone path for a repo URL.
func (c *Client) CloneDir(repoURL string) (string, error) {
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		return "", err
	}
	return filepath.Join(c.rootDir, "repos", owner, repo), nil
}

func (c *Client) pullDefaultBranch(cloneDir string) error {
	branch, err := c.DefaultBranch(cloneDir)
	if err != nil {
		return err
	}

	// Fetch then update the local branch ref to match origin.
	fetch := exec.Command("git", "-C", cloneDir, "fetch", "origin", branch)
	if output, err := fetch.CombinedOutput(); err != nil {
		return fmt.Errorf("git fetch: %w: %s", err, string(output))
	}

	update := exec.Command("git", "-C", cloneDir, "update-ref", "refs/heads/"+branch, "refs/remotes/origin/"+branch)
	if output, err := update.CombinedOutput(); err != nil {
		return fmt.Errorf("git update-ref: %w: %s", err, string(output))
	}

	return nil
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

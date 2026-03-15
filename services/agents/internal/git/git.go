package git

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Client wraps git CLI operations for repo cloning and worktree management.
type Client struct {
	rootDir string
}

// NewClient creates a git client that stores repos and worktrees under rootDir.
func NewClient(rootDir string) *Client {
	return &Client{rootDir: rootDir}
}

// EnsureClone clones the repo if it doesn't exist, or pulls the default branch
// if it does. Returns the path to the bare clone directory.
func (c *Client) EnsureClone(repoURL string) (string, error) {
	owner, repo, err := parseRepoURL(repoURL)
	if err != nil {
		return "", fmt.Errorf("parsing repo URL: %w", err)
	}

	cloneDir := filepath.Join(c.rootDir, "repos", owner, repo)

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
	return parts[len(parts)-1], nil
}

// AddWorktree creates a new worktree at worktreeDir based on baseRef.
// If baseRef is empty, uses the default branch.
func (c *Client) AddWorktree(cloneDir, worktreeDir, baseRef string) error {
	if baseRef == "" {
		branch, err := c.DefaultBranch(cloneDir)
		if err != nil {
			return err
		}
		baseRef = branch
	}

	cmd := exec.Command("git", "-C", cloneDir, "worktree", "add", "--detach", worktreeDir, "origin/"+baseRef)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git worktree add: %w: %s", err, string(output))
	}
	return nil
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

	// Fetch then merge to update the local branch.
	fetch := exec.Command("git", "-C", cloneDir, "fetch", "origin", branch)
	if output, err := fetch.CombinedOutput(); err != nil {
		return fmt.Errorf("git fetch: %w: %s", err, string(output))
	}

	// Update the local branch ref to match origin.
	update := exec.Command("git", "-C", cloneDir, "update-ref", "refs/heads/"+branch, "refs/remotes/origin/"+branch)
	if output, err := update.CombinedOutput(); err != nil {
		return fmt.Errorf("git update-ref: %w: %s", err, string(output))
	}

	return nil
}

// parseRepoURL extracts owner and repo from HTTPS or SSH git URLs.
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
		return segments[len(segments)-2], segments[len(segments)-1], nil
	}

	// Handle HTTPS format: https://github.com/owner/repo.git
	u, err := url.Parse(repoURL)
	if err != nil {
		return "", "", fmt.Errorf("parsing URL: %w", err)
	}
	path := strings.TrimSuffix(strings.TrimPrefix(u.Path, "/"), ".git")
	segments := strings.Split(path, "/")
	if len(segments) < 2 {
		return "", "", fmt.Errorf("invalid HTTPS repo URL path: %s", repoURL)
	}
	return segments[len(segments)-2], segments[len(segments)-1], nil
}

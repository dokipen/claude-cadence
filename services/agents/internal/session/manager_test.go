package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/vault"
)

func newCreateTestManager(profiles map[string]config.Profile) *Manager {
	return &Manager{
		store:         NewStore(),
		profiles:      profiles,
		ptyHasSession: func(id string) bool { return false },
		processAlive:  func(pid int) bool { return false },
	}
}

func TestSessionNameRe(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"alphanumeric only", "myagent123", true},
		{"with hyphens", "my-agent-session", true},
		{"with underscores", "my_agent_session", true},
		{"with dots", "my.agent.1", true},
		{"with tilde mid-name", "my~session", true},
		{"mixed allowed chars", "agent_1.0~beta-2", true},
		{"leading dot", ".hidden", false},
		{"leading tilde", "~my-session", false},
		{"space", "my session", false},
		{"forward slash", "my/session", false},
		{"backslash", `my\session`, false},
		{"null byte", "sess\x00ion", false},
		{"newline", "sess\nion", false},
		{"unicode letter", "séssion", false},
		{"unicode emoji", "agent🚀", false},
		{"at sign", "user@host", false},
		{"semicolon", "sess;ion", false},
		{"empty string", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sessionNameRe.MatchString(tt.input)
			if got != tt.want {
				t.Errorf("sessionNameRe.MatchString(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestCreate_SessionNameInvalidCharsReturnErrInvalidArgument(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	tests := []struct {
		name        string
		sessionName string
	}{
		{"space in name", "my session"},
		{"leading space", " session"},
		{"trailing space", "session "},
		{"forward slash", "my/session"},
		{"backslash", `my\session`},
		{"null byte", "sess\x00ion"},
		{"newline", "sess\nion"},
		{"tab", "sess\tion"},
		{"unicode letter", "séssion"},
		{"unicode emoji", "agent🚀"},
		{"at sign", "user@host"},
		{"semicolon", "sess;ion"},
		{"leading dot", ".hidden"},
		{"leading tilde", "~session"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newCreateTestManager(profiles)
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				SessionName:  tt.sessionName,
			})
			if err == nil {
				t.Fatalf("expected error for name %q, got nil", tt.sessionName)
			}
			sesErr, ok := err.(*Error)
			if !ok || sesErr.Code != ErrInvalidArgument {
				t.Errorf("expected ErrInvalidArgument for name %q, got %v", tt.sessionName, err)
			}
		})
	}
}

func TestCreate_SessionNameTooLong(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	// Build boundary-value names using only valid characters (all lowercase a).
	// sessionNameRe requires the first char to be alphanumeric, which "a" satisfies.
	name255 := strings.Repeat("a", 255)
	name256 := strings.Repeat("a", 256)

	t.Run("exactly 255 chars accepted", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		var gotInvalidArg bool
		func() {
			defer func() { recover() }() // swallow nil-PTY panic; that means validation passed
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				SessionName:  name255,
			})
			var sesErr *Error
			if errors.As(err, &sesErr) && sesErr.Code == ErrInvalidArgument {
				gotInvalidArg = true
			}
		}()
		if gotInvalidArg {
			t.Errorf("expected 255-char name to be accepted, got ErrInvalidArgument")
		}
	})

	t.Run("256 chars rejected", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		_, err := m.Create(CreateRequest{
			AgentProfile: "default",
			SessionName:  name256,
		})
		if err == nil {
			t.Fatalf("expected ErrInvalidArgument for 256-char name, got nil")
		}
		sesErr, ok := err.(*Error)
		if !ok || sesErr.Code != ErrInvalidArgument {
			t.Errorf("expected ErrInvalidArgument for 256-char name, got %v", err)
		}
	})
}

func TestCreate_EnvVarValueTooLong(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	// Build boundary-value env var values (all lowercase a).
	value4096 := strings.Repeat("a", 4096)
	value4097 := strings.Repeat("a", 4097)

	t.Run("exactly 4096 bytes accepted", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		var gotInvalidArg bool
		func() {
			defer func() { recover() }() // swallow nil-PTY panic; that means validation passed
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				SessionName:  "test-session",
				Env:          map[string]string{"KEY": value4096},
			})
			var sesErr *Error
			if errors.As(err, &sesErr) && sesErr.Code == ErrInvalidArgument {
				gotInvalidArg = true
			}
		}()
		if gotInvalidArg {
			t.Errorf("expected 4096-byte env var value to be accepted, got ErrInvalidArgument")
		}
	})

	t.Run("4097 bytes rejected", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		_, err := m.Create(CreateRequest{
			AgentProfile: "default",
			SessionName:  "test-session",
			Env:          map[string]string{"KEY": value4097},
		})
		if err == nil {
			t.Fatalf("expected ErrInvalidArgument for 4097-byte env var value, got nil")
		}
		var sessionErr *Error
		if !errors.As(err, &sessionErr) {
			t.Fatalf("expected *Error, got %T", err)
		}
		if sessionErr.Code != ErrInvalidArgument {
			t.Errorf("expected ErrInvalidArgument, got %v", sessionErr.Code)
		}
	})
}

func TestCreate_EnvVarCountTooMany(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	t.Run("exactly 64 env vars accepted", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		env := make(map[string]string, 64)
		for i := range 64 {
			env[fmt.Sprintf("KEY_%d", i)] = "value"
		}
		var gotInvalidArg bool
		func() {
			defer func() { recover() }() // swallow nil-PTY panic; that means validation passed
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				SessionName:  "test-session",
				Env:          env,
			})
			var sesErr *Error
			if errors.As(err, &sesErr) && sesErr.Code == ErrInvalidArgument {
				gotInvalidArg = true
			}
		}()
		if gotInvalidArg {
			t.Errorf("expected 64 env vars to be accepted, got ErrInvalidArgument")
		}
	})

	t.Run("65 env vars rejected", func(t *testing.T) {
		m := newCreateTestManager(profiles)
		env := make(map[string]string, 65)
		for i := range 65 {
			env[fmt.Sprintf("KEY_%d", i)] = "value"
		}
		_, err := m.Create(CreateRequest{
			AgentProfile: "default",
			SessionName:  "test-session",
			Env:          env,
		})
		if err == nil {
			t.Fatalf("expected ErrInvalidArgument for 65 env vars, got nil")
		}
		var sessionErr *Error
		if !errors.As(err, &sessionErr) {
			t.Fatalf("expected *Error, got %T", err)
		}
		if sessionErr.Code != ErrInvalidArgument {
			t.Errorf("expected ErrInvalidArgument, got %v", sessionErr.Code)
		}
	})
}

func TestShellEscapeArg(t *testing.T) {
	tests := []struct {
		name string
		arg  string
		want string
	}{
		{"simple", "hello", "'hello'"},
		{"with spaces", "hello world", "'hello world'"},
		{"with single quote", "it's", `'it'\''s'`},
		{"with semicolon", "foo;rm -rf /", "'foo;rm -rf /'"},
		{"with backticks", "`whoami`", "'`whoami`'"},
		{"with dollar", "$(evil)", "'$(evil)'"},
		{"with pipe", "foo|bar", "'foo|bar'"},
		{"with ampersand", "foo&&bar", "'foo&&bar'"},
		{"with newline", "foo\nbar", "'foo\nbar'"},
		{"empty", "", "''"},
		{"with double quotes", `say "hi"`, `'say "hi"'`},
		{"multiple single quotes", "a'b'c", `'a'\''b'\''c'`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shellEscapeArg(tt.arg)
			if got != tt.want {
				t.Errorf("shellEscapeArg(%q) = %q, want %q", tt.arg, got, tt.want)
			}
		})
	}
}

func TestRenderCommand(t *testing.T) {
	m := &Manager{}

	tests := []struct {
		name      string
		template  string
		sess      *Session
		extraArgs []string
		want      string
	}{
		{
			name:     "WorktreePath with spaces is escaped",
			template: "cmd --cwd {{.WorktreePath}}",
			sess: &Session{
				ID:           "test-id",
				Name:         "test-name",
				WorktreePath: "/path/with spaces/dir",
			},
			want: "cmd --cwd '/path/with spaces/dir'",
		},
		{
			name:     "WorktreePath with shell metacharacters is escaped",
			template: "cmd --cwd {{.WorktreePath}}",
			sess: &Session{
				ID:           "test-id",
				Name:         "test-name",
				WorktreePath: "/path/$(evil)/dir",
			},
			want: "cmd --cwd '/path/$(evil)/dir'",
		},
		{
			name:     "empty WorktreePath produces empty string not quoted",
			template: "cmd --cwd {{.WorktreePath}}",
			sess: &Session{
				ID:   "test-id",
				Name: "test-name",
			},
			want: "cmd --cwd ",
		},
		{
			name:     "empty WorktreePath with conditional template omits flag",
			template: "cmd{{if .WorktreePath}} --cwd {{.WorktreePath}}{{end}}",
			sess: &Session{
				ID:   "test-id",
				Name: "test-name",
			},
			want: "cmd",
		},
		{
			name:     "non-empty WorktreePath with conditional template includes flag",
			template: "cmd{{if .WorktreePath}} --cwd {{.WorktreePath}}{{end}}",
			sess: &Session{
				ID:           "test-id",
				Name:         "test-name",
				WorktreePath: "/some/path",
			},
			want: "cmd --cwd '/some/path'",
		},
		{
			name:     "SessionID is escaped",
			template: "cmd --id {{.SessionID}}",
			sess: &Session{
				ID:   "id;rm -rf /",
				Name: "test-name",
			},
			want: "cmd --id 'id;rm -rf /'",
		},
		{
			name:     "all fields together",
			template: "cmd --id {{.SessionID}} --name {{.SessionName}} --cwd {{.WorktreePath}} {{.ExtraArgs}}",
			sess: &Session{
				ID:           "test-id",
				Name:         "test-name",
				WorktreePath: "/safe/path",
			},
			extraArgs: []string{"--flag", "value"},
			want:      "cmd --id 'test-id' --name test-name --cwd '/safe/path' '--flag' 'value'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := m.renderCommand(tt.template, tt.sess, tt.extraArgs, "")
			if err != nil {
				t.Fatalf("renderCommand() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("renderCommand() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRenderCommandPluginDir(t *testing.T) {
	m := &Manager{}

	tests := []struct {
		name      string
		template  string
		sess      *Session
		extraArgs []string
		pluginDir string
		want      string
	}{
		{
			name:      "PluginDir with spaces is escaped",
			template:  "cmd --plugin-dir {{.PluginDir}}",
			sess:      &Session{ID: "test-id", Name: "test-name"},
			pluginDir: "/path/with spaces/plugin",
			want:      "cmd --plugin-dir '/path/with spaces/plugin'",
		},
		{
			name:      "PluginDir with shell metacharacters is escaped",
			template:  "cmd --plugin-dir {{.PluginDir}}",
			sess:      &Session{ID: "test-id", Name: "test-name"},
			pluginDir: "/path/$(injection)/plugin",
			want:      "cmd --plugin-dir '/path/$(injection)/plugin'",
		},
		{
			name:      "empty PluginDir produces empty string not quoted",
			template:  "cmd --plugin-dir {{.PluginDir}}",
			sess:      &Session{ID: "test-id", Name: "test-name"},
			pluginDir: "",
			want:      "cmd --plugin-dir ",
		},
		{
			name:      "empty PluginDir with conditional omits flag",
			template:  "cmd{{if .PluginDir}} --plugin-dir {{.PluginDir}}{{end}}",
			sess:      &Session{ID: "test-id", Name: "test-name"},
			pluginDir: "",
			want:      "cmd",
		},
		{
			name:      "non-empty PluginDir with conditional includes flag",
			template:  "cmd{{if .PluginDir}} --plugin-dir {{.PluginDir}}{{end}}",
			sess:      &Session{ID: "test-id", Name: "test-name"},
			pluginDir: "/some/plugin",
			want:      "cmd --plugin-dir '/some/plugin'",
		},
		{
			name:      "all fields with PluginDir",
			template:  "cmd --id {{.SessionID}} --name {{.SessionName}} --cwd {{.WorktreePath}}{{if .PluginDir}} --plugin-dir {{.PluginDir}}{{end}} {{.ExtraArgs}}",
			sess:      &Session{ID: "test-id", Name: "test-name", WorktreePath: "/safe/path"},
			extraArgs: []string{"--flag", "value"},
			pluginDir: "/my/plugin",
			want:      "cmd --id 'test-id' --name test-name --cwd '/safe/path' --plugin-dir '/my/plugin' '--flag' 'value'",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := m.renderCommand(tt.template, tt.sess, tt.extraArgs, tt.pluginDir)
			if err != nil {
				t.Fatalf("renderCommand() error: %v", err)
			}
			if got != tt.want {
				t.Errorf("renderCommand() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestShellJoinArgs(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want string
	}{
		{"nil", nil, ""},
		{"empty slice", []string{}, ""},
		{"single arg", []string{"hello"}, "'hello'"},
		{"multiple args", []string{"hello", "world"}, "'hello' 'world'"},
		{"with injection", []string{"--flag", ";rm -rf /"}, "'--flag' ';rm -rf /'"},
		{"preserves each arg", []string{"a b", "c d"}, "'a b' 'c d'"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shellJoinArgs(tt.args)
			if got != tt.want {
				t.Errorf("shellJoinArgs(%v) = %q, want %q", tt.args, got, tt.want)
			}
		})
	}
}

func TestManager_MustGetReturnsErrorOnMissing(t *testing.T) {
	m := newCreateTestManager(nil)
	sess, err := m.mustGet("nonexistent-id")
	if sess != nil {
		t.Errorf("mustGet() session = %v, want nil", sess)
	}
	if err == nil {
		t.Error("mustGet() error = nil, want non-nil")
	}
}

func TestCreate_ResourceExhausted(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}
	m := newCreateTestManager(profiles)
	m.maxSessions = 1

	// Pre-fill the store with one session to hit the cap immediately.
	m.store.Add(&Session{ID: "pre-existing", Name: "pre-existing", State: StateRunning})

	// Create should now fail with ErrResourceExhausted.
	_, err := m.Create(CreateRequest{
		AgentProfile: "default",
		SessionName:  "new-session",
	})
	if err == nil {
		t.Fatal("Create() = nil, want ErrResourceExhausted")
	}
	sesErr, ok := err.(*Error)
	if !ok || sesErr.Code != ErrResourceExhausted {
		t.Errorf("Create() error = %v (%T), want *Error{Code: ErrResourceExhausted}", err, err)
	}
}

func TestCreate_ConcurrentSameNameOnlyOneSucceeds(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	const goroutines = 10
	m := newCreateTestManager(profiles)

	var wg sync.WaitGroup
	// passedUniquenessCheck counts goroutines that got past the atomic TryAdd
	// uniqueness check, evidenced by reaching the pty.Create call (which panics
	// with nil pty). With the TOCTOU bug, multiple goroutines pass the
	// uniqueness check before any of them inserts into the store.
	type outcome int
	const (
		outcomeAlreadyExists outcome = iota
		outcomePassedCheck            // passed uniqueness check (nil-pty panic or success)
		outcomeOther
	)
	outcomes := make([]outcome, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		i := i
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					// The nil PTY causes a panic here, which we recover from as
					// evidence the goroutine passed the uniqueness gate. This is
					// intentional — we only need to verify the gate behavior,
					// not full session creation.
					outcomes[i] = outcomePassedCheck
				}
			}()
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				SessionName:  "shared-name",
			})
			if err == nil {
				outcomes[i] = outcomePassedCheck
				return
			}
			sesErr, ok := err.(*Error)
			if ok && sesErr.Code == ErrAlreadyExists {
				outcomes[i] = outcomeAlreadyExists
			} else {
				outcomes[i] = outcomeOther
			}
		}()
	}
	wg.Wait()

	var passedCheck, alreadyExists, other int
	for _, o := range outcomes {
		switch o {
		case outcomePassedCheck:
			passedCheck++
		case outcomeAlreadyExists:
			alreadyExists++
		default:
			other++
		}
	}

	if other != 0 {
		t.Errorf("unexpected outcomes: %d goroutines returned neither ErrAlreadyExists nor passed the check", other)
	}
	// With the TOCTOU bug, passedCheck > 1 because multiple goroutines both
	// see the name as absent before either inserts.
	if passedCheck != 1 {
		t.Errorf("passedCheck = %d, want exactly 1 (TOCTOU: %d goroutines raced past the name-uniqueness check)", passedCheck, passedCheck)
	}
	if alreadyExists != goroutines-1 {
		t.Errorf("alreadyExists = %d, want %d", alreadyExists, goroutines-1)
	}

	// Verify the store has exactly 1 session named "shared-name".
	// Sessions persist here because the nil-PTY panic unwinds the goroutine
	// before any cleanup or delete runs — so the winning goroutine's session
	// remains in the store after the test completes.
	var namedCount int
	for _, s := range m.store.List() {
		if s.Name == "shared-name" {
			namedCount++
		}
	}
	if namedCount != 1 {
		t.Errorf("store has %d sessions named \"shared-name\", want 1 (TOCTOU allowed duplicate inserts)", namedCount)
	}
}

func TestCreate_ConcurrentAutoNameNeverCollides(t *testing.T) {
	profiles := map[string]config.Profile{
		"default": {Command: "echo {{.SessionName}}"},
	}

	const goroutines = 10
	m := newCreateTestManager(profiles)

	var wg sync.WaitGroup
	// gate is closed once all goroutines are ready, ensuring maximum concurrency
	// when auto-generating session names.
	gate := make(chan struct{})

	type outcome int
	const (
		outcomePassedCheck   outcome = iota // passed uniqueness check (nil-pty panic or success)
		outcomeAlreadyExists                // got ErrAlreadyExists — means a name collision
		outcomeOther
	)
	outcomes := make([]outcome, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		i := i
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					// The nil PTY causes a panic after the store uniqueness gate,
					// which we recover from as evidence the goroutine passed the
					// gate with its auto-generated name.
					outcomes[i] = outcomePassedCheck
				}
			}()
			// Wait for all goroutines to be ready before proceeding.
			<-gate
			_, err := m.Create(CreateRequest{
				AgentProfile: "default",
				// SessionName intentionally empty — triggers auto-generation.
			})
			if err == nil {
				outcomes[i] = outcomePassedCheck
				return
			}
			sesErr, ok := err.(*Error)
			if ok && sesErr.Code == ErrAlreadyExists {
				outcomes[i] = outcomeAlreadyExists
			} else {
				outcomes[i] = outcomeOther
			}
		}()
	}

	// Release all goroutines simultaneously.
	close(gate)
	wg.Wait()

	var passedCheck, alreadyExists, other int
	for _, o := range outcomes {
		switch o {
		case outcomePassedCheck:
			passedCheck++
		case outcomeAlreadyExists:
			alreadyExists++
		default:
			other++
		}
	}

	if other != 0 {
		t.Errorf("unexpected outcomes: %d goroutines returned an unexpected error (neither ErrAlreadyExists nor passed the check)", other)
	}
	// Auto-generated names must never collide: every goroutine should pass the
	// uniqueness check. Any ErrAlreadyExists indicates two goroutines received
	// identical auto-generated names.
	if alreadyExists != 0 {
		t.Errorf("alreadyExists = %d, want 0: auto-generated session names collided under concurrency", alreadyExists)
	}
	if passedCheck != goroutines {
		t.Errorf("passedCheck = %d, want %d: not all goroutines passed the uniqueness gate", passedCheck, goroutines)
	}

	// Verify the store contains exactly 10 distinct session names.
	sessions := m.store.List()
	if len(sessions) != goroutines {
		t.Errorf("store has %d sessions, want %d", len(sessions), goroutines)
	}
	seen := make(map[string]bool, goroutines)
	for _, s := range sessions {
		if seen[s.Name] {
			t.Errorf("duplicate session name %q found in store", s.Name)
		}
		seen[s.Name] = true
	}
}

// TestDestroy_ConcurrentDeleteBetweenReconcileAndTransition reproduces the
// TOCTOU race in Destroy(): store.Get succeeds, reconcile is called (which
// calls ptyHasSession), a concurrent goroutine deletes the session, then
// store.Transition(StateDestroying) returns ErrNotFound — which is silently
// discarded — and pty.Destroy is still called on the already-deleted session.
//
// The test asserts that pty.Destroy is NOT called when the session was
// concurrently deleted before Transition could run.  With the bug present,
// pty.Destroy IS called, so the test fails.  After the fix it will pass.
func TestDestroy_ConcurrentDeleteBetweenReconcileAndTransition(t *testing.T) {
	store := NewStore()

	// deleted is closed once the concurrent delete has completed.
	deleted := make(chan struct{})
	// reconciling is closed when ptyHasSession is first called (inside reconcile).
	reconciling := make(chan struct{})

	// Track whether ptyDestroy was invoked.
	var ptyDestroyCalled bool

	m := &Manager{
		store:        store,
		processAlive: func(pid int) bool { return false },
		// ptyHasSession is the synchronisation hook: signal that reconcile has
		// started, then wait for the concurrent delete to finish before returning.
		ptyHasSession: func(id string) bool {
			close(reconciling) // signal: we are inside reconcile now
			<-deleted          // wait: concurrent delete has run
			return true        // returning true means reconcile won't change state
		},
		ptyDestroy: func(id string) error {
			ptyDestroyCalled = true
			return nil
		},
	}

	// Add a running session directly to the store.
	sess := &Session{
		ID:    "test-session-toctou",
		Name:  "test-session-toctou",
		State: StateRunning,
	}
	store.Add(sess)

	// Goroutine: wait until reconcile has started, then delete the session.
	go func() {
		<-reconciling          // wait until ptyHasSession is entered
		store.Delete(sess.ID)  // concurrent delete: removes session from store
		close(deleted)         // signal: delete is done
	}()

	// Call Destroy with force=true. After reconcile (which sees ptyHasSession=true
	// and leaves the session as StateRunning), the concurrent delete has already
	// removed the session. store.Transition returns ErrNotFound, which is silently
	// discarded, and then (with the bug) m.ptyDestroy is called anyway.
	err := m.Destroy(sess.ID, true /*force*/)

	// Destroy should return nil — the session is already gone, postcondition satisfied.
	if err != nil {
		t.Fatalf("Destroy() returned unexpected error: %v", err)
	}

	// The critical assertion: pty.Destroy must NOT be called when the session was
	// concurrently deleted before Transition could mark it as Destroying.
	// With the current bug, ptyDestroyCalled == true, causing this test to fail.
	if ptyDestroyCalled {
		t.Error("pty.Destroy was called after concurrent store.Delete — TOCTOU bug: Destroy() should detect that Transition returned ErrNotFound and skip cleanup")
	}
}

// fakeVaultHTTPServer returns a test server that serves a single KV v2 secret at the given path.
func fakeVaultHTTPServer(t *testing.T, secretPath string, data map[string]interface{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trimmed := strings.TrimPrefix(r.URL.Path, "/v1/")
		if trimmed != secretPath {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprintf(w, `{"errors":["not found"]}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{"data": data},
		})
	}))
}

func TestCreate_VaultOverLengthValueSkipped(t *testing.T) {
	// Vault secrets that exceed maxEnvVarValueLen must be skipped with a warning,
	// not treated as a hard error. Session creation must succeed.
	overLengthVal := strings.Repeat("x", maxEnvVarValueLen+1)
	srv := fakeVaultHTTPServer(t, "secret/data/test", map[string]interface{}{
		"normal_key": "short-value",
		"huge_key":   overLengthVal,
	})
	t.Cleanup(srv.Close)

	vaultClient, err := vault.NewClient(&config.VaultConfig{
		Address:    srv.URL,
		AuthMethod: "token",
		Token:      "unused",
	})
	if err != nil {
		t.Fatalf("vault.NewClient: %v", err)
	}

	profiles := map[string]config.Profile{
		"vault-profile": {
			Command:     "sleep 3600",
			VaultSecret: "secret/data/test",
		},
	}
	m := newCreateTestManager(profiles)
	m.vault = vaultClient

	var gotInvalidArg bool
	func() {
		defer func() { recover() }() // swallow nil-PTY panic; means validation passed
		_, createErr := m.Create(CreateRequest{
			AgentProfile: "vault-profile",
			SessionName:  "test-vault-overlength",
		})
		var sesErr *Error
		if errors.As(createErr, &sesErr) && sesErr.Code == ErrInvalidArgument {
			gotInvalidArg = true
		}
	}()

	if gotInvalidArg {
		t.Error("over-length vault value should be skipped with a warning, not rejected with ErrInvalidArgument")
	}
}

func TestCreate_VaultNullByteValueSkipped(t *testing.T) {
	// Vault secrets containing null bytes must be skipped with a warning.
	srv := fakeVaultHTTPServer(t, "secret/data/test", map[string]interface{}{
		"null_key": "value\x00with-null",
	})
	t.Cleanup(srv.Close)

	vaultClient, err := vault.NewClient(&config.VaultConfig{
		Address:    srv.URL,
		AuthMethod: "token",
		Token:      "unused",
	})
	if err != nil {
		t.Fatalf("vault.NewClient: %v", err)
	}

	profiles := map[string]config.Profile{
		"vault-profile": {
			Command:     "sleep 3600",
			VaultSecret: "secret/data/test",
		},
	}
	m := newCreateTestManager(profiles)
	m.vault = vaultClient

	var gotInvalidArg bool
	func() {
		defer func() { recover() }() // swallow nil-PTY panic; means validation passed
		_, createErr := m.Create(CreateRequest{
			AgentProfile: "vault-profile",
			SessionName:  "test-vault-nullbyte",
		})
		var sesErr *Error
		if errors.As(createErr, &sesErr) && sesErr.Code == ErrInvalidArgument {
			gotInvalidArg = true
		}
	}()

	if gotInvalidArg {
		t.Error("vault value with null byte should be skipped with a warning, not rejected with ErrInvalidArgument")
	}
}

// addInFlightCreatingSession registers a session exactly as Manager.Create()
// does after store.TryAdd and before pty.Create: StateCreating with no
// AgentPID, no PTY handle and no PTYSlavePath. The Create goroutine exclusively
// owns such a session until it transitions it to running/error/stopped.
func addInFlightCreatingSession(t *testing.T, m *Manager, id string) {
	t.Helper()
	if err := m.store.TryAdd(&Session{
		ID:           id,
		Name:         id,
		AgentProfile: "default",
		ProfileType:  "agent",
		State:        StateCreating,
		CreatedAt:    time.Now(),
	}, 0); err != nil {
		t.Fatalf("store.TryAdd(%q): %v", id, err)
	}
}

// assertInFlightSessionStillCreating verifies that the in-flight session is
// still StateCreating in the store and that Create() can still complete its
// Creating -> Running transition, which is what Create() does after
// pty.Create returns. op names the Manager method that was just called.
func assertInFlightSessionStillCreating(t *testing.T, m *Manager, id, op string) {
	t.Helper()
	stored, ok := m.store.Get(id)
	if !ok {
		t.Fatalf("%s removed in-flight session %q from the store", op, id)
	}
	if stored.State != StateCreating {
		t.Errorf("%s moved in-flight session to %s; Create() can no longer reach running", op, stored.State)
	}
	if err := m.store.Transition(id, StateRunning, func(s *Session) {
		s.AgentPID = 4242
		s.PTYSlavePath = "/dev/ttys999"
	}); err != nil {
		t.Errorf("Create()'s Creating -> Running transition failed after %s: %v", op, err)
	}
}

// TestList_DoesNotReapInFlightCreatingSession reproduces #699: Manager.List()
// reconciles every session, and for a session that Create() has registered as
// StateCreating but has not yet handed to pty.Create (AgentPID == 0, no PTY),
// reconcile() sees "no PTY" and moves it Creating -> Stopped. Create() then
// fails its Creating -> Running transition. The in-flight session belongs to
// the Create goroutine (and, for stuck creates, the Cleaner's
// creating_session_ttl); List() must leave it alone.
func TestList_DoesNotReapInFlightCreatingSession(t *testing.T) {
	m := newCreateTestManager(nil) // ptyHasSession always returns false
	const id = "in-flight-list"
	addInFlightCreatingSession(t, m, id)

	got, err := m.List("")
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("List() returned %d sessions, want 1", len(got))
	}
	if got[0].ID != id {
		t.Fatalf("List() returned session %q, want %q", got[0].ID, id)
	}
	if got[0].State != StateCreating {
		t.Errorf("List() returned in-flight session with state %s, want %s", got[0].State, StateCreating)
	}

	assertInFlightSessionStillCreating(t, m, id, "List()")
}

// TestGet_DoesNotReapInFlightCreatingSession is the Manager.Get() sibling of
// TestList_DoesNotReapInFlightCreatingSession (#699).
func TestGet_DoesNotReapInFlightCreatingSession(t *testing.T) {
	m := newCreateTestManager(nil) // ptyHasSession always returns false
	const id = "in-flight-get"
	addInFlightCreatingSession(t, m, id)

	got, err := m.Get(id)
	if err != nil {
		t.Fatalf("Get() error: %v", err)
	}
	if got.State != StateCreating {
		t.Errorf("Get() returned in-flight session with state %s, want %s", got.State, StateCreating)
	}

	assertInFlightSessionStillCreating(t, m, id, "Get()")
}

// TestDestroy_ForceDestroysInFlightCreatingSession is a guard for the #699 fix
// rather than a reproduction: a force Destroy of an in-flight creating session
// must still succeed (Creating -> Destroying is a valid edge) and tear down the
// PTY, even once reconcile() stops touching in-flight sessions. It passes both
// before and after the fix.
func TestDestroy_ForceDestroysInFlightCreatingSession(t *testing.T) {
	m := newCreateTestManager(nil)
	const id = "in-flight-destroy"
	addInFlightCreatingSession(t, m, id)

	var destroyed []string
	m.ptyDestroy = func(id string) error {
		destroyed = append(destroyed, id)
		return nil
	}

	if err := m.Destroy(id, true /*force*/); err != nil {
		t.Fatalf("Destroy(force=true) of in-flight creating session: %v", err)
	}
	if _, ok := m.store.Get(id); ok {
		t.Error("session still in the store after Destroy(force=true)")
	}
	if len(destroyed) != 1 || destroyed[0] != id {
		t.Errorf("ptyDestroy calls = %v, want exactly [%q]", destroyed, id)
	}
}

// stalledVaultHTTPServer is like fakeVaultHTTPServer, but the secret handler
// blocks until release is called, holding the caller of vault.GetSecret (and so
// Manager.Create(), between store.TryAdd and pty.Create) in StateCreating.
//
// entered is closed the first time the secret handler is reached. release is
// idempotent and is also registered as a cleanup that runs before the server
// is closed, so the handler can never keep the server (or the test) from
// shutting down. A handler whose client has gone away is released as well.
func stalledVaultHTTPServer(t *testing.T, secretPath string, data map[string]interface{}) (srv *httptest.Server, entered <-chan struct{}, release func()) {
	t.Helper()
	enteredCh := make(chan struct{})
	gate := make(chan struct{})
	var enterOnce, releaseOnce sync.Once

	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trimmed := strings.TrimPrefix(r.URL.Path, "/v1/")
		if trimmed != secretPath {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprintf(w, `{"errors":["not found"]}`)
			return
		}
		enterOnce.Do(func() { close(enteredCh) })
		select {
		case <-gate:
		case <-r.Context().Done():
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"data": map[string]interface{}{"data": data},
		})
	}))
	release = func() { releaseOnce.Do(func() { close(gate) }) }

	// Cleanups run LIFO: registering Close first means release runs before it.
	t.Cleanup(srv.Close)
	t.Cleanup(release)
	return srv, enteredCh, release
}

// TestCreate_ListDuringCreateLeavesSessionRunning is the end-to-end
// reproduction of #699. Create() is held in StateCreating (after store.TryAdd,
// before pty.Create) by a stalled Vault fetch; a List() call - the hub's
// 10-second listSessions poll - lands in that window; Vault is then released.
// Create() must still return a running session carrying the real AgentPID and
// PTYSlavePath instead of a nil-error "stopped" session with AgentPID == 0
// whose PTY process is alive.
func TestCreate_ListDuringCreateLeavesSessionRunning(t *testing.T) {
	const (
		secretPath  = "secret/data/test"
		waitTimeout = 10 * time.Second
	)
	srv, vaultEntered, releaseVault := stalledVaultHTTPServer(t, secretPath, map[string]interface{}{
		"some_key": "some-value",
	})

	vaultClient, err := vault.NewClient(&config.VaultConfig{
		Address:    srv.URL,
		AuthMethod: "token",
		Token:      "unused",
	})
	if err != nil {
		t.Fatalf("vault.NewClient: %v", err)
	}

	ptyMgr := pty.NewPTYManager(pty.PTYConfig{})
	store := NewStore()
	profiles := map[string]config.Profile{
		"stalled-vault": {
			// exec so the PTY child is the sleep itself and Destroy's kill
			// cannot orphan a bash-forked sleep.
			Command:     "exec sleep 3600",
			VaultSecret: secretPath,
		},
	}
	m := NewManager(store, ptyMgr, nil, vaultClient, profiles, 0)

	type createResult struct {
		sess *Session
		err  error
	}
	resultCh := make(chan createResult, 1)
	createDone := make(chan struct{})

	// Registered after stalledVaultHTTPServer's cleanups, so it runs first:
	// unblock Vault, let any in-flight Create() finish (so it cannot start a
	// PTY after the teardown below), then kill every PTY process we started.
	t.Cleanup(func() {
		releaseVault()
		select {
		case <-createDone:
		case <-time.After(waitTimeout):
			t.Errorf("Create() did not return within %v of releasing Vault", waitTimeout)
		}
		for _, s := range store.List() {
			_ = ptyMgr.Destroy(s.ID)
		}
	})

	go func() {
		defer close(createDone)
		sess, err := m.Create(CreateRequest{
			AgentProfile: "stalled-vault",
			SessionName:  "list-during-create",
		})
		resultCh <- createResult{sess: sess, err: err}
	}()

	// Wait until Create() is blocked inside the Vault fetch, i.e. after
	// store.TryAdd and before pty.Create.
	select {
	case <-vaultEntered:
	case r := <-resultCh:
		t.Fatalf("Create() returned before reaching the Vault fetch: sess=%+v err=%v", r.sess, r.err)
	case <-time.After(waitTimeout):
		t.Fatalf("timed out after %v waiting for Create() to reach the Vault fetch", waitTimeout)
	}

	// Poll for the session to show up in StateCreating. It is registered before
	// the Vault request is made, so this should hold immediately.
	var sessionID string
	deadline := time.Now().Add(waitTimeout)
	for {
		for _, s := range store.List() {
			if s.State == StateCreating {
				sessionID = s.ID
			}
		}
		if sessionID != "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out after %v waiting for a StateCreating session in the store", waitTimeout)
		}
		time.Sleep(5 * time.Millisecond)
	}

	// The listSessions poll lands while Create() is stalled before pty.Create.
	listed, err := m.List("")
	if err != nil {
		t.Fatalf("List() error: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("List() returned %d sessions, want 1", len(listed))
	}
	t.Logf("List() during Create() reported session %s as %s", listed[0].ID, listed[0].State)

	releaseVault()

	var res createResult
	select {
	case res = <-resultCh:
	case <-time.After(waitTimeout):
		t.Fatalf("timed out after %v waiting for Create() to return after releasing Vault", waitTimeout)
	}
	if res.err != nil {
		t.Fatalf("Create() error: %v", res.err)
	}
	if res.sess == nil {
		t.Fatal("Create() returned a nil session and a nil error")
	}
	sess := res.sess

	// The PTY manager is the ground truth for whether the process is alive.
	ptyPID, ptyErr := ptyMgr.PID(sess.ID)
	ptyAlive := ptyErr == nil && isProcessAlive(ptyPID)

	if sess.State != StateRunning || sess.AgentPID == 0 {
		if ptyAlive {
			t.Errorf("Create() returned state=%s agent_pid=%d while PTY process %d is alive", sess.State, sess.AgentPID, ptyPID)
		} else {
			t.Errorf("Create() returned state=%s agent_pid=%d (PTY pid=%d, pty error=%v)", sess.State, sess.AgentPID, ptyPID, ptyErr)
		}
	}
	if sess.AgentPID > 0 && !isProcessAlive(sess.AgentPID) {
		t.Errorf("Create() returned agent_pid=%d but that process is not alive", sess.AgentPID)
	}
	if sess.AgentPID > 0 && ptyAlive && sess.AgentPID != ptyPID {
		t.Errorf("Create() returned agent_pid=%d, want PTY child pid %d", sess.AgentPID, ptyPID)
	}
	if sess.PTYSlavePath == "" {
		t.Error("Create() returned an empty PTYSlavePath")
	}

	// The store must agree with the returned session.
	stored, ok := store.Get(sess.ID)
	if !ok {
		t.Fatalf("session %q missing from the store after Create()", sess.ID)
	}
	if stored.State != StateRunning {
		t.Errorf("store state after Create() = %s, want %s", stored.State, StateRunning)
	}
}

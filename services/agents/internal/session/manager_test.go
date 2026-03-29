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

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
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

package session

import (
	"testing"
)

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

package e2e_test

import (
	"os"
	"strings"
	"testing"
)

// renderTemplate simulates the sed-based template rendering from install.sh.
func renderTemplate(template string, vars map[string]string) string {
	result := template
	for placeholder, value := range vars {
		result = strings.ReplaceAll(result, placeholder, value)
	}
	return result
}

func defaultVars() map[string]string {
	return map[string]string{
		"__BINARY_PATH__":     "/usr/local/bin/agentd",
		"__CONFIG_PATH__":     "/etc/agentd/config.yaml",
		"__ENV_PATH__":        "/etc/agentd/env",
		"__USER__":            "agentd",
		"__GROUP__":           "agentd",
		"__ROOT_DIR__":        "/var/lib/agentd",
		"__LOG_DIR__":         "/var/log/agentd",
		"__HUB_AGENT_TOKEN__": "",
	}
}

func TestInstall_PlistGeneration(t *testing.T) {
	tmpl, err := os.ReadFile("../../install/agentd.plist.tmpl")
	if err != nil {
		t.Fatalf("reading plist template: %v", err)
	}

	rendered := renderTemplate(string(tmpl), defaultVars())

	// Verify no unreplaced placeholders remain.
	if strings.Contains(rendered, "__") {
		t.Error("rendered plist contains unreplaced placeholders")
	}

	// Verify key plist elements.
	checks := []struct {
		name string
		want string
	}{
		{"label", "<string>com.cadence.agentd</string>"},
		{"binary", "<string>/usr/local/bin/agentd</string>"},
		{"config flag", "<string>--config</string>"},
		{"config path", "<string>/etc/agentd/config.yaml</string>"},
		{"username", "<string>agentd</string>"},
		{"keepalive", "<true/>"},
		{"run at load", "<true/>"},
		{"stdout log", "<string>/var/log/agentd/agentd.stdout.log</string>"},
		{"stderr log", "<string>/var/log/agentd/agentd.stderr.log</string>"},
		{"working dir", "<string>/var/lib/agentd</string>"},
	}

	for _, c := range checks {
		if !strings.Contains(rendered, c.want) {
			t.Errorf("plist missing %s: expected %q", c.name, c.want)
		}
	}

	// Verify valid XML structure.
	if !strings.HasPrefix(strings.TrimSpace(rendered), "<?xml") {
		t.Error("plist does not start with XML declaration")
	}
	if !strings.HasSuffix(strings.TrimSpace(rendered), "</plist>") {
		t.Error("plist does not end with </plist>")
	}
}

func TestInstall_SystemdGeneration(t *testing.T) {
	tmpl, err := os.ReadFile("../../install/agentd.service.tmpl")
	if err != nil {
		t.Fatalf("reading systemd template: %v", err)
	}

	rendered := renderTemplate(string(tmpl), defaultVars())

	// Verify no unreplaced placeholders remain.
	if strings.Contains(rendered, "__") {
		t.Error("rendered unit file contains unreplaced placeholders")
	}

	// Verify key systemd directives.
	checks := []struct {
		name string
		want string
	}{
		{"description", "Description=Cadence Agent Service"},
		{"after", "After=network.target"},
		{"type", "Type=simple"},
		{"user", "User=agentd"},
		{"group", "Group=agentd"},
		{"exec start", `ExecStart="/usr/local/bin/agentd" --config "/etc/agentd/config.yaml"`},
		{"env file", "EnvironmentFile=-/etc/agentd/env"},
		{"working dir", "WorkingDirectory=/var/lib/agentd"},
		{"restart", "Restart=on-failure"},
		{"restart sec", "RestartSec=5"},
		{"syslog id", "SyslogIdentifier=agentd"},
		{"wanted by", "WantedBy=multi-user.target"},
	}

	for _, c := range checks {
		if !strings.Contains(rendered, c.want) {
			t.Errorf("unit file missing %s: expected %q", c.name, c.want)
		}
	}

	// Verify section headers.
	for _, section := range []string{"[Unit]", "[Service]", "[Install]"} {
		if !strings.Contains(rendered, section) {
			t.Errorf("unit file missing section %s", section)
		}
	}
}

func TestInstall_PlistCustomValues(t *testing.T) {
	tmpl, err := os.ReadFile("../../install/agentd.plist.tmpl")
	if err != nil {
		t.Fatalf("reading plist template: %v", err)
	}

	vars := map[string]string{
		"__BINARY_PATH__":     "/opt/agentd/bin/agentd",
		"__CONFIG_PATH__":     "/home/deploy/.config/agentd/config.yaml",
		"__USER__":            "deploy",
		"__GROUP__":           "deploy",
		"__ROOT_DIR__":        "/data/agentd",
		"__LOG_DIR__":         "/home/deploy/logs",
		"__HUB_AGENT_TOKEN__": "",
	}

	rendered := renderTemplate(string(tmpl), vars)

	if strings.Contains(rendered, "__") {
		t.Error("rendered plist contains unreplaced placeholders")
	}
	if !strings.Contains(rendered, "/opt/agentd/bin/agentd") {
		t.Error("custom binary path not rendered")
	}
	if !strings.Contains(rendered, "/home/deploy/.config/agentd/config.yaml") {
		t.Error("custom config path not rendered")
	}
	if !strings.Contains(rendered, "<string>deploy</string>") {
		t.Error("custom username not rendered")
	}
}

func TestInstall_SystemdCustomValues(t *testing.T) {
	tmpl, err := os.ReadFile("../../install/agentd.service.tmpl")
	if err != nil {
		t.Fatalf("reading systemd template: %v", err)
	}

	vars := map[string]string{
		"__BINARY_PATH__": "/opt/agentd/bin/agentd",
		"__CONFIG_PATH__": "/etc/agentd/custom.yaml",
		"__ENV_PATH__":    "/etc/agentd/custom.env",
		"__USER__":        "svcuser",
		"__GROUP__":       "svcgroup",
		"__ROOT_DIR__":    "/data/agentd",
		"__LOG_DIR__":     "/var/log/agentd",
	}

	rendered := renderTemplate(string(tmpl), vars)

	if strings.Contains(rendered, "__") {
		t.Error("rendered unit file contains unreplaced placeholders")
	}
	if !strings.Contains(rendered, "User=svcuser") {
		t.Error("custom user not rendered")
	}
	if !strings.Contains(rendered, "Group=svcgroup") {
		t.Error("custom group not rendered")
	}
	if !strings.Contains(rendered, `ExecStart="/opt/agentd/bin/agentd" --config "/etc/agentd/custom.yaml"`) {
		t.Error("custom exec start not rendered")
	}
}

func TestInstall_PlistWithHubToken(t *testing.T) {
	tmpl, err := os.ReadFile("../../install/agentd.plist.tmpl")
	if err != nil {
		t.Fatalf("reading plist template: %v", err)
	}

	vars := defaultVars()
	vars["__HUB_AGENT_TOKEN__"] = "test-hub-secret"
	rendered := renderTemplate(string(tmpl), vars)

	if strings.Contains(rendered, "__") {
		t.Error("rendered plist contains unreplaced placeholders")
	}
	if !strings.Contains(rendered, "<key>HUB_AGENT_TOKEN</key>") {
		t.Error("plist missing HUB_AGENT_TOKEN environment variable key")
	}
	if !strings.Contains(rendered, "<string>test-hub-secret</string>") {
		t.Error("plist missing hub token value")
	}
}

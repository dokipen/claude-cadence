package e2e_test

import (
	"fmt"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
	"github.com/dokipen/claude-cadence/services/agents/internal/pty"
	"github.com/dokipen/claude-cadence/services/agents/internal/session"
)

var testMgr *session.Manager

func TestMain(m *testing.M) {
	// Load test config
	cfg, err := config.Load("testdata/config.yaml")
	if err != nil {
		log.Fatalf("loading test config: %v", err)
	}

	// Create components
	ptyManager := pty.NewPTYManager(pty.PTYConfig{BufferSize: cfg.PTY.BufferSize})
	store := session.NewStore()
	testMgr = session.NewManager(store, ptyManager, nil, nil, cfg.Profiles, 0)

	// Run tests
	code := m.Run()

	os.Exit(code)
}

func uniqueSessionName(t *testing.T) string {
	t.Helper()
	// Use test name (sanitized) + nanos for uniqueness
	name := strings.ReplaceAll(t.Name(), "/", "-")
	name = strings.ReplaceAll(name, " ", "-")
	// Keep only safe chars
	safe := ""
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			safe += string(c)
		}
	}
	return fmt.Sprintf("e2e-%s-%d", safe, time.Now().UnixNano())
}

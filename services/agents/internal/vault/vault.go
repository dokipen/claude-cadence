package vault

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dokipen/claude-cadence/services/agents/internal/config"
)

// Client reads secrets from a HashiCorp Vault server.
type Client struct {
	address    string
	token      string
	httpClient *http.Client
}

// NewClient creates a Vault client from config, performing authentication if needed.
func NewClient(cfg *config.VaultConfig) (*Client, error) {
	c := &Client{
		address:    strings.TrimRight(cfg.Address, "/"),
		httpClient: http.DefaultClient,
	}

	switch cfg.AuthMethod {
	case "token":
		c.token = cfg.ResolveToken()
		if c.token == "" {
			return nil, fmt.Errorf("vault token not provided: set VAULT_TOKEN or configure token/token_env_var")
		}
	case "approle":
		token, err := c.loginAppRole(cfg.RoleID, cfg.ResolveSecretID())
		if err != nil {
			return nil, fmt.Errorf("vault approle login: %w", err)
		}
		c.token = token
	default:
		return nil, fmt.Errorf("unsupported vault auth method: %q", cfg.AuthMethod)
	}

	return c, nil
}

// GetSecret reads a secret from the given Vault path and returns
// the data map (the "data" field inside the response's "data" object
// for KV v2, or the "data" object itself for KV v1).
func (c *Client) GetSecret(path string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/v1/%s", c.address, strings.TrimPrefix(path, "/"))

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("X-Vault-Token", c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vault request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("vault returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing vault response: %w", err)
	}

	// Try KV v2 format first: data.data contains the actual secret.
	var kvV2 struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(result.Data, &kvV2); err == nil && kvV2.Data != nil {
		return kvV2.Data, nil
	}

	// Fall back to KV v1 format: data is the secret directly.
	var data map[string]interface{}
	if err := json.Unmarshal(result.Data, &data); err != nil {
		return nil, fmt.Errorf("parsing vault secret data: %w", err)
	}
	return data, nil
}

// loginAppRole authenticates using the AppRole method and returns the client token.
func (c *Client) loginAppRole(roleID, secretID string) (string, error) {
	url := fmt.Sprintf("%s/v1/auth/approle/login", c.address)

	payload := fmt.Sprintf(`{"role_id":%q,"secret_id":%q}`, roleID, secretID)
	req, err := http.NewRequest("POST", url, strings.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("approle login request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("approle login returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Auth struct {
			ClientToken string `json:"client_token"`
		} `json:"auth"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parsing login response: %w", err)
	}
	if result.Auth.ClientToken == "" {
		return "", fmt.Errorf("approle login returned empty token")
	}
	return result.Auth.ClientToken, nil
}

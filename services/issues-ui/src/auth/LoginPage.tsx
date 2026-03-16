import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "./AuthContext";
import { createRawClient } from "../api/client";
import { GENERATE_OAUTH_STATE } from "../api/queries";

const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [pat, setPat] = useState("");
  const [error, setError] = useState<string | null>(() => {
    const errorParam = searchParams.get("error");
    if (!errorParam) return null;
    return errorParam === "auth_failed"
      ? "Authentication failed. Please try again."
      : "An error occurred. Please try again.";
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await login(pat.trim());
      navigate("/", { replace: true });
    } catch {
      setError("Authentication failed. Please check your token and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOAuthLogin() {
    setError(null);
    setIsSubmitting(true);

    try {
      const client = createRawClient();
      const result = await client.request<{ generateOAuthState: string }>(
        GENERATE_OAUTH_STATE,
      );
      const state = result.generateOAuthState;
      sessionStorage.setItem("oauth_state", state);

      const params = new URLSearchParams({
        client_id: GITHUB_CLIENT_ID!,
        state,
        redirect_uri: `${window.location.origin}/auth/callback`,
      });
      window.location.href = `https://github.com/login/oauth/authorize?${params}`;
    } catch {
      setError("Failed to start GitHub sign-in. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <img
          src="/cadence-icon.svg"
          alt="Cadence"
          width={64}
          height={64}
          style={{ marginBottom: "1rem" }}
        />
        <h1 style={styles.title}>Cadence</h1>
        <p style={styles.subtitle}>Sign in to continue</p>

        {error && <p style={styles.error} role="alert">{error}</p>}

        {GITHUB_CLIENT_ID && (
          <>
            <button
              onClick={handleOAuthLogin}
              disabled={isSubmitting}
              style={{
                ...styles.oauthButton,
                opacity: isSubmitting ? 0.6 : 1,
              }}
            >
              Sign in with GitHub
            </button>
            <div style={styles.divider}>
              <span style={styles.dividerText}>or</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          <label htmlFor="pat" style={styles.label}>
            GitHub Personal Access Token
          </label>
          <input
            id="pat"
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="ghp_..."
            required
            disabled={isSubmitting}
            style={styles.input}
          />

          <button
            type="submit"
            disabled={isSubmitting || !pat.trim()}
            style={{
              ...styles.button,
              opacity: isSubmitting || !pat.trim() ? 0.6 : 1,
            }}
          >
            {isSubmitting ? "Signing in…" : "Sign in with PAT"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
    padding: "1rem",
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "12px",
    padding: "2.5rem",
    width: "100%",
    maxWidth: "400px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  title: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: "1.8rem",
    letterSpacing: "-0.02em",
    color: "var(--primary)",
    margin: 0,
    marginTop: "-2px",
    marginLeft: "-6px",
  },
  subtitle: {
    color: "var(--text-secondary)",
    marginTop: "0.25rem",
    marginBottom: "1.5rem",
    fontSize: "0.95rem",
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  label: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "var(--text)",
  },
  input: {
    width: "100%",
    padding: "0.6rem 0.75rem",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    fontSize: "0.95rem",
    fontFamily: "inherit",
    background: "var(--bg)",
    color: "var(--text)",
    boxSizing: "border-box",
  },
  error: {
    color: "#d73a4a",
    fontSize: "0.85rem",
    margin: 0,
  },
  oauthButton: {
    width: "100%",
    padding: "0.65rem 1rem",
    background: "#24292f",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "0.95rem",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  },
  divider: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    margin: "0.25rem 0",
  },
  dividerText: {
    color: "var(--text-secondary)",
    fontSize: "0.85rem",
    flexShrink: 0,
  },
  button: {
    marginTop: "0.5rem",
    padding: "0.65rem 1rem",
    background: "var(--primary)",
    color: "#fff",
    border: "none",
    borderRadius: "6px",
    fontSize: "0.95rem",
    fontWeight: 600,
    fontFamily: "inherit",
    cursor: "pointer",
  },
};

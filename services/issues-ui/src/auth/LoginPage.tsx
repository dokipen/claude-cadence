import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "./AuthContext";
import { createRawClient } from "../api/client";
import { GENERATE_OAUTH_STATE } from "../api/queries";
import { validateRedirect } from "./validateRedirect";
import styles from "../styles/login.module.css";

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
      navigate(validateRedirect(searchParams.get("redirect")), { replace: true });
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

      const redirectTarget = validateRedirect(searchParams.get("redirect"));
      if (redirectTarget !== "/") {
        sessionStorage.setItem("oauth_redirect", redirectTarget);
      }

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
    <div className={styles.container}>
      <div className={styles.card}>
        <img
          src="/cadence-icon.svg"
          alt="Cadence"
          width={64}
          height={64}
          style={{ marginBottom: "1rem" }}
        />
        <h1 className={styles.title}>Cadence</h1>
        <p className={styles.subtitle}>Sign in to continue</p>

        {error && <p className={styles.error} role="alert">{error}</p>}

        {GITHUB_CLIENT_ID && (
          <>
            <button
              onClick={handleOAuthLogin}
              disabled={isSubmitting}
              className={styles.oauthButton}
              style={{ opacity: isSubmitting ? 0.6 : 1 }}
            >
              Sign in with GitHub
            </button>
            <div className={styles.divider}>
              <span className={styles.dividerText}>or</span>
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className={styles.form}>
          <label htmlFor="pat" className={styles.label}>
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
            className={styles.input}
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={isSubmitting || !pat.trim()}
            className={styles.button}
            style={{ opacity: isSubmitting || !pat.trim() ? 0.6 : 1 }}
          >
            {isSubmitting ? "Signing in\u2026" : "Sign in with PAT"}
          </button>
        </form>
      </div>
    </div>
  );
}

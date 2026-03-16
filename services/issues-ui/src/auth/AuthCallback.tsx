import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "./AuthContext";

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loginWithCode } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(
        errorParam === "access_denied"
          ? "GitHub authorization was denied."
          : `GitHub authorization failed: ${errorParam}`,
      );
      return;
    }

    if (!code || !state) {
      setError("Missing authorization code or state parameter.");
      return;
    }

    const savedState = sessionStorage.getItem("oauth_state");
    if (!savedState || savedState !== state) {
      setError("OAuth state mismatch. Please try signing in again.");
      return;
    }

    sessionStorage.removeItem("oauth_state");

    loginWithCode(code, state)
      .then(() => {
        navigate("/", { replace: true });
      })
      .catch(() => {
        setError("Authentication failed. Please try again.");
      });
  }, [searchParams, loginWithCode, navigate]);

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.error} role="alert">{error}</p>
          <a href="/login" style={styles.link}>Back to login</a>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <p style={styles.loading}>Completing sign in…</p>
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
    gap: "1rem",
  },
  error: {
    color: "#d73a4a",
    fontSize: "0.95rem",
    margin: 0,
    textAlign: "center",
  },
  link: {
    color: "var(--primary)",
    fontSize: "0.95rem",
    textDecoration: "none",
  },
  loading: {
    color: "var(--text-muted)",
    fontSize: "0.95rem",
  },
};

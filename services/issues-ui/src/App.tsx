import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={styles.loading}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppShell() {
  const { user, logout } = useAuth();

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <img src="/cadence-icon-light.svg" alt="" width={24} height={24} />
          <span style={styles.logoText}>Cadence</span>
        </div>
        <div style={styles.headerRight}>
          {user && (
            <>
              <span style={styles.userInfo} data-testid="user-info">
                {user.displayName || user.login}
              </span>
              <button onClick={logout} style={styles.logoutButton}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>
      <main style={styles.main}>
        <p style={{ color: "var(--text-secondary)" }}>
          Board coming soon.
        </p>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;

const styles: Record<string, React.CSSProperties> = {
  loading: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
  },
  shell: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 1.25rem",
    height: "52px",
    background: "var(--primary-dark)",
    color: "#fff",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  logoText: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontWeight: 700,
    fontSize: "1.1rem",
    letterSpacing: "-0.02em",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  userInfo: {
    fontSize: "0.85rem",
    opacity: 0.9,
  },
  logoutButton: {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    padding: "0.3rem 0.6rem",
    fontSize: "0.8rem",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  main: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};

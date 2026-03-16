import { useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { KanbanBoard } from "./components/KanbanBoard";
import { ProjectSelector, STORAGE_KEY } from "./components/ProjectSelector";
import type { ReactNode } from "react";
import layoutStyles from "./styles/layout.module.css";

const loadingStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--bg)",
};

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={loadingStyle}>
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  const handleProjectChange = useCallback((id: string) => {
    setSelectedProjectId(id);
  }, []);

  return (
    <div className={layoutStyles.shell}>
      <header className={layoutStyles.header}>
        <div className={layoutStyles.headerLeft}>
          <img src="/cadence-icon-light.svg" alt="" width={24} height={24} />
          <span className={layoutStyles.logoText}>Cadence</span>
        </div>
        <div className={layoutStyles.headerCenter}>
          <ProjectSelector
            selectedProjectId={selectedProjectId}
            onProjectChange={handleProjectChange}
          />
        </div>
        <div className={layoutStyles.headerRight}>
          {user && (
            <>
              <span className={layoutStyles.userInfo} data-testid="user-info">
                {user.displayName || user.login}
              </span>
              <button onClick={logout} className={layoutStyles.logoutButton}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>
      <main className={layoutStyles.main}>
        <KanbanBoard projectId={selectedProjectId} />
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

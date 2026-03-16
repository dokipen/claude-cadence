import { useState, useCallback } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AuthCallback } from "./auth/AuthCallback";
import { KanbanBoard } from "./components/KanbanBoard";
import { FilterBar } from "./components/FilterBar";
import { TicketDetail } from "./components/TicketDetail";
import { ProjectSelector, STORAGE_KEY } from "./components/ProjectSelector";
import type { TicketFilters } from "./hooks/useTickets";
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
  const location = useLocation();

  if (isLoading) {
    return (
      <div style={loadingStyle}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    const redirect = location.pathname + location.search + location.hash;
    const loginUrl = redirect && redirect !== "/"
      ? `/login?redirect=${encodeURIComponent(redirect)}`
      : "/login";
    return <Navigate to={loginUrl} replace />;
  }

  return children;
}

function AppShell() {
  const { user, logout } = useAuth();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [filters, setFilters] = useState<TicketFilters>({});

  const handleProjectChange = useCallback((id: string) => {
    setSelectedProjectId(id);
    setFilters({});
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
      {selectedProjectId && (
        <FilterBar filters={filters} onChange={setFilters} />
      )}
      <main className={layoutStyles.main}>
        <Routes>
          <Route path="/ticket/:id" element={<TicketDetail />} />
          <Route
            path="/*"
            element={<KanbanBoard projectId={selectedProjectId} filters={filters} />}
          />
        </Routes>
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
          <Route path="/auth/callback" element={<AuthCallback />} />
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

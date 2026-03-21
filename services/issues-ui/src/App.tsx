import { useState, useCallback, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation, useMatch, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginPage } from "./auth/LoginPage";
import { AuthCallback } from "./auth/AuthCallback";
import { KanbanBoard } from "./components/KanbanBoard";
import { FilterBar } from "./components/FilterBar";
import { TicketDetail } from "./components/TicketDetail";
import { AgentManager } from "./components/AgentManager";
import { ProjectSelector } from "./components/ProjectSelector";
import { useProjects } from "./hooks/useProjects";
import type { TicketFilters } from "./hooks/useTickets";
import { useAllSessions } from "./hooks/useAllSessions";
import { NotificationDropdown } from "./components/NotificationDropdown";
import type { ReactNode } from "react";
import layoutStyles from "./styles/layout.module.css";

export const STORAGE_KEY = "cadence_project_id";

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

function ProjectRedirect() {
  const { projects, loading, error } = useProjects();

  if (loading) {
    return (
      <div style={loadingStyle}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (error && projects.length === 0) {
    return (
      <div style={loadingStyle}>
        <p style={{ color: "var(--text-muted)" }}>Failed to load projects</p>
      </div>
    );
  }

  if (projects.length > 0) {
    let savedId: string | null = null;
    try { savedId = sessionStorage.getItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    const target = savedId && projects.some((p) => p.id === savedId)
      ? savedId
      : projects[0].id;
    return <Navigate to={`/projects/${target}`} replace />;
  }

  return (
    <div style={loadingStyle}>
      <p style={{ color: "var(--text-muted)" }}>No projects available</p>
    </div>
  );
}

function AppShell() {
  const { user, logout } = useAuth();
  const { projects } = useProjects();
  const { sessions, waitingSessions } = useAllSessions();
  const location = useLocation();
  const navigate = useNavigate();
  const boardMatch = useMatch("/projects/:projectId/*");
  const projectId = boardMatch?.params.projectId ?? null;
  const [filters, setFilters] = useState<TicketFilters>({});
  const showFilters = projectId && !location.pathname.startsWith("/ticket/") && !location.pathname.startsWith("/agents");

  useEffect(() => {
    if (projectId) {
      try { sessionStorage.setItem(STORAGE_KEY, projectId); } catch { /* storage unavailable */ }
    }
  }, [projectId]);

  const selectedProject = projects.find((p) => p.id === projectId);
  const repoUrl = selectedProject?.repository;

  const handleProjectChange = useCallback((id: string) => {
    if (!projects.some((p) => p.id === id)) return;
    navigate(`/projects/${id}`);
    try { sessionStorage.setItem(STORAGE_KEY, id); } catch { /* storage unavailable */ }
    setFilters({});
  }, [projects, navigate]);

  return (
    <div className={layoutStyles.shell}>
      <header className={layoutStyles.header}>
        <div className={layoutStyles.headerLeft}>
          <Link to="/" className={layoutStyles.logoLink}>
            <img src="/cadence-icon-light.svg" alt="" width={24} height={24} />
            <span className={layoutStyles.logoText}>Cadence</span>
          </Link>
          <Link to="/agents" className={layoutStyles.navLink} data-testid="agents-nav-link">
            Agents
          </Link>
          <NotificationDropdown waitingSessions={waitingSessions} />
        </div>
        <div className={layoutStyles.headerCenter}>
          {projectId !== null ? (
            <ProjectSelector
              selectedProjectId={projectId}
              onProjectChange={handleProjectChange}
            />
          ) : null}
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
      {showFilters && (
        <FilterBar filters={filters} onChange={setFilters} />
      )}
      <main className={layoutStyles.main}>
        <Routes>
          <Route path="/agents" element={<AgentManager sessions={sessions} />} />
          <Route
            path="/projects/:projectId/*"
            element={<KanbanBoard projectId={projectId} filters={filters} repoUrl={repoUrl} />}
          />
          <Route path="/ticket/:id" element={<TicketDetail />} />
          <Route path="/*" element={<ProjectRedirect />} />
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

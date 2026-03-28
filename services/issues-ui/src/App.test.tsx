// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { STORAGE_KEY, PROJECT_ID_RE, AppShell } from "./App";
import { makeSessionStorageMock } from './test-utils/makeSessionStorageMock';

// Mocks for AppShell component tests
vi.mock("./auth/AuthContext", () => ({
  useAuth: vi.fn(() => ({
    user: { login: "test", displayName: "Test User" },
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
  })),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("./hooks/useProjects", () => ({
  useProjects: vi.fn(() => ({ projects: [], loading: false, error: null })),
}));
vi.mock("./hooks/useAllSessions", () => ({
  useAllSessions: vi.fn(() => ({
    sessions: [],
    waitingSessions: [],
    optimisticSetDestroying: vi.fn(),
    optimisticResetState: vi.fn(),
    optimisticAddSession: vi.fn(),
  })),
}));
vi.mock("./hooks/useVersionPolling", () => ({
  useVersionPolling: vi.fn(() => ({ updateAvailable: false })),
}));
vi.mock("./styles/layout.module.css", () => ({ default: {} }));
vi.mock("./components/KanbanBoard", () => ({
  KanbanBoard: () => <div data-testid="kanban-board">KanbanBoard</div>,
}));
vi.mock("./components/FilterBar", () => ({ FilterBar: () => null }));
vi.mock("./components/AgentManager", () => ({ AgentManager: () => null }));
vi.mock("./components/ProjectSelector", () => ({ ProjectSelector: () => null }));
vi.mock("./components/NotificationDropdown", () => ({ NotificationDropdown: () => null }));
vi.mock("./components/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("./components/TicketDetail", () => ({ TicketDetail: () => null }));

const PROJECTS = [
  { id: "proj-a", name: "Project A" },
  { id: "proj-b", name: "Project B" },
];

function resolveTargetProject(projects: typeof PROJECTS): string {
  let savedId = sessionStorage.getItem(STORAGE_KEY);
  if (savedId !== null && !PROJECT_ID_RE.test(savedId)) savedId = null;
  return savedId && projects.some((p) => p.id === savedId)
    ? savedId
    : projects[0].id;
}

let mockStorage: ReturnType<typeof makeSessionStorageMock>;

beforeEach(() => {
  mockStorage = makeSessionStorageMock();
  vi.stubGlobal("sessionStorage", mockStorage);
});

describe("ProjectRedirect sessionStorage resolution", () => {
  it("redirects to saved project when ID is valid", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj-b");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-b");
  });

  it("falls back to first project when saved ID is not in list", () => {
    sessionStorage.setItem(STORAGE_KEY, "deleted-project");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("falls back to first project when no ID is saved", () => {
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });
});

describe("ProjectRedirect format validation", () => {
  it("rejects a project ID with underscores (underscore rejected by agentd sessionNameRe)", () => {
    sessionStorage.setItem(STORAGE_KEY, "my_project");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("rejects an ID with path-traversal characters", () => {
    sessionStorage.setItem(STORAGE_KEY, "../../../etc/passwd");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("rejects an ID with angle brackets", () => {
    sessionStorage.setItem(STORAGE_KEY, "<script>alert(1)</script>");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("rejects an ID with spaces", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj a");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });
});

describe("AppShell URL param validation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders error state when projectId in URL contains spaces", () => {
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={["/projects/bad id/"]}>
        <AppShell />
      </MemoryRouter>
    );
    expect(getByTestId("invalid-project-id-error")).toBeTruthy();
    expect(queryByTestId("kanban-board")).toBeNull();
  });

  it("renders error state when projectId in URL contains unicode characters", () => {
    // PROJECT_ID_RE only allows [a-zA-Z0-9._~-], so unicode letters are rejected
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/projects/caf\u00E9/"]}>
        <AppShell />
      </MemoryRouter>
    );
    expect(getByTestId("invalid-project-id-error")).toBeTruthy();
  });

  it("renders error state when projectId in URL contains a percent-encoded slash", () => {
    // React Router decodes %2F to "/" in the matched segment value, producing "a/b"
    // which contains a slash and fails PROJECT_ID_RE
    const { getByTestId } = render(
      <MemoryRouter initialEntries={["/projects/a%2Fb/"]}>
        <AppShell />
      </MemoryRouter>
    );
    expect(getByTestId("invalid-project-id-error")).toBeTruthy();
  });

  it("does not write invalid projectId to sessionStorage", () => {
    render(
      <MemoryRouter initialEntries={["/projects/bad id/"]}>
        <AppShell />
      </MemoryRouter>
    );
    expect(mockStorage.setItem).not.toHaveBeenCalledWith(STORAGE_KEY, "bad id");
  });

  it("renders KanbanBoard for a valid projectId", () => {
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={["/projects/valid-project/"]}>
        <AppShell />
      </MemoryRouter>
    );
    expect(getByTestId("kanban-board")).toBeTruthy();
    expect(queryByTestId("invalid-project-id-error")).toBeNull();
  });
});

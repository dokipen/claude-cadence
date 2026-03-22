// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { TicketDetail as TicketDetailType, Project } from "../types";

const mockDetailNavigate = vi.fn();

// --- Mock hooks before any imports that use them ---
vi.mock("../hooks/useProjects", () => ({
  useProjects: vi.fn(),
}));

vi.mock("../hooks/useTicket", () => ({
  useTicket: vi.fn(),
}));

// Mock react-router hooks and components
const mockNavigateFn = vi.fn();
vi.mock("react-router", () => ({
  useParams: vi.fn(),
  useSearchParams: vi.fn(),
  useNavigate: () => mockDetailNavigate,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  Navigate: ({ to }: { to: string }) => {
    mockNavigateFn(to);
    return <div data-testid="navigate" data-to={to} />;
  },
}));

vi.mock("./ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

vi.mock("../hooks/useTransitionTicket", () => ({
  useTransitionTicket: () => ({
    transition: vi.fn().mockResolvedValue(undefined),
    loading: false,
    error: null,
  }),
}));

// Mock child components that have complex dependencies
vi.mock("./PriorityBadge", () => ({
  PriorityBadge: () => <span data-testid="priority-badge" />,
}));

vi.mock("./LabelBadge", () => ({
  LabelBadge: () => <span data-testid="label-badge" />,
}));

vi.mock("./Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

vi.mock("./AgentTab", () => ({
  AgentTab: () => <div data-testid="agent-tab" />,
}));

// Mock CSS modules
vi.mock("../styles/detail.module.css", () => ({ default: {} }));
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

import { TicketDetail } from "./TicketDetail";
import { useProjects } from "../hooks/useProjects";
import { useTicket } from "../hooks/useTicket";
import { useParams, useSearchParams } from "react-router";

const mockUseProjects = useProjects as ReturnType<typeof vi.fn>;
const mockUseTicket = useTicket as ReturnType<typeof vi.fn>;
const mockUseParams = useParams as ReturnType<typeof vi.fn>;
const mockUseSearchParams = useSearchParams as ReturnType<typeof vi.fn>;

const KNOWN_PROJECT: Project = { id: "proj-known", name: "Known Project" };
const UNKNOWN_PROJECT_ID = "proj-unknown-xyz";

function makeTicket(projectId: string): TicketDetailType {
  return {
    id: "ticket-1",
    number: 42,
    title: "Test Ticket",
    state: "BACKLOG",
    priority: "MEDIUM",
    labels: [],
    blockedBy: [],
    blocks: [],
    comments: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    project: {
      id: projectId,
      name: "Some Project",
      repository: "https://github.com/example/repo",
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigateFn.mockClear();
  mockDetailNavigate.mockClear();

  // Default router setup
  mockUseParams.mockReturnValue({ id: "ticket-1" });
  const setSearchParams = vi.fn();
  mockUseSearchParams.mockReturnValue([new URLSearchParams(), setSearchParams]);
});

afterEach(() => {
  cleanup();
});

describe("TicketDetail project validation (defense-in-depth)", () => {
  it("redirects to / when ticket's project.id is not in the known projects list", () => {
    mockUseTicket.mockReturnValue({
      ticket: makeTicket(UNKNOWN_PROJECT_ID),
      loading: false,
      error: null,
    });
    mockUseProjects.mockReturnValue({
      projects: [KNOWN_PROJECT],
      loading: false,
      error: null,
    });

    const { getByTestId } = render(<TicketDetail />);

    expect(getByTestId("navigate")).toBeTruthy();
    expect(getByTestId("navigate").getAttribute("data-to")).toBe("/");
  });

  it("does not render ticket content when project id is invalid", () => {
    mockUseTicket.mockReturnValue({
      ticket: makeTicket(UNKNOWN_PROJECT_ID),
      loading: false,
      error: null,
    });
    mockUseProjects.mockReturnValue({
      projects: [KNOWN_PROJECT],
      loading: false,
      error: null,
    });

    const { queryByTestId } = render(<TicketDetail />);

    expect(queryByTestId("ticket-detail")).toBeNull();
  });

  it("renders normally when ticket's project.id IS in the known projects list", () => {
    mockUseTicket.mockReturnValue({
      ticket: makeTicket(KNOWN_PROJECT.id),
      loading: false,
      error: null,
    });
    mockUseProjects.mockReturnValue({
      projects: [KNOWN_PROJECT],
      loading: false,
      error: null,
    });

    const { getByTestId, queryByTestId } = render(<TicketDetail />);

    expect(getByTestId("ticket-detail")).toBeTruthy();
    expect(queryByTestId("navigate")).toBeNull();
  });

  it("does NOT redirect while projects are still loading", () => {
    mockUseTicket.mockReturnValue({
      ticket: makeTicket(UNKNOWN_PROJECT_ID),
      loading: false,
      error: null,
    });
    // Projects loading = true means we cannot yet validate; should not redirect
    mockUseProjects.mockReturnValue({
      projects: [],
      loading: true,
      error: null,
    });

    const { queryByTestId } = render(<TicketDetail />);

    expect(queryByTestId("navigate")).toBeNull();
    // Ticket detail should be rendered while we wait for projects to load
    expect(queryByTestId("ticket-detail")).toBeTruthy();
  });

  it("does NOT redirect when projects list is empty after loading", () => {
    // Edge case: projects loaded but empty list — no redirect since we cannot
    // definitively invalidate the project id
    mockUseTicket.mockReturnValue({
      ticket: makeTicket(UNKNOWN_PROJECT_ID),
      loading: false,
      error: null,
    });
    mockUseProjects.mockReturnValue({
      projects: [],
      loading: false,
      error: null,
    });

    const { queryByTestId } = render(<TicketDetail />);

    expect(queryByTestId("navigate")).toBeNull();
    expect(queryByTestId("ticket-detail")).toBeTruthy();
  });
});

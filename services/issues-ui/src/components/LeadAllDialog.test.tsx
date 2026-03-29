// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { Ticket } from "../types";

// Mock CSS modules
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));
vi.mock("../styles/agents.module.css", () => ({ default: {} }));

// Mock hooks and API
vi.mock("../hooks/useAgents", () => ({
  useAgents: vi.fn(),
  useAgentProfiles: vi.fn(),
}));

vi.mock("../api/agentHubClient", () => ({
  createSession: vi.fn(),
}));

import { LeadAllDialog } from "./LeadAllDialog";
import { useAgents, useAgentProfiles } from "../hooks/useAgents";
import type { AgentProfileEntry } from "../hooks/useAgents";
import { createSession } from "../api/agentHubClient";

const mockUseAgents = vi.mocked(useAgents);
const mockUseAgentProfiles = vi.mocked(useAgentProfiles);
const mockCreateSession = vi.mocked(createSession);

const makeTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: "t1",
  number: 42,
  title: "Do the thing",
  state: "REFINED",
  priority: "MEDIUM",
  labels: [],
  blockedBy: [],
  ...overrides,
});

const defaultAgentsResult = { agents: [], loading: false, error: null };

const mockProfiles = [
  {
    agent: "agent-1",
    profileName: "default",
    profile: { name: "default", type: "claude", repo: undefined },
  },
  {
    agent: "agent-2",
    profileName: "fast",
    profile: { name: "fast", type: "claude", repo: undefined },
  },
] as unknown as AgentProfileEntry[];

const defaultProps = {
  repoUrl: "https://github.com/org/repo",
  open: false,
  onClose: vi.fn(),
  projectId: "my-project",
  tickets: [makeTicket()],
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });

  mockUseAgents.mockReturnValue(defaultAgentsResult);
  mockUseAgentProfiles.mockReturnValue(mockProfiles);
  mockCreateSession.mockResolvedValue({} as ReturnType<typeof mockCreateSession> extends Promise<infer T> ? T : never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Dialog lifecycle
// ---------------------------------------------------------------------------

describe("LeadAllDialog open/close lifecycle", () => {
  it("calls showModal when open changes to true", () => {
    const { rerender } = render(<LeadAllDialog {...defaultProps} open={false} />);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();

    rerender(<LeadAllDialog {...defaultProps} open={true} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("calls close when open changes to false", () => {
    const { rerender } = render(<LeadAllDialog {...defaultProps} open={true} />);
    rerender(<LeadAllDialog {...defaultProps} open={false} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("X button calls onClose", () => {
    const onClose = vi.fn();
    render(<LeadAllDialog {...defaultProps} open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("dialog-close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel button calls onClose", () => {
    const onClose = vi.fn();
    render(<LeadAllDialog {...defaultProps} open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("cancel-button"));
    expect(onClose).toHaveBeenCalled();
  });

  it("backdrop click calls onClose", () => {
    const onClose = vi.fn();
    render(<LeadAllDialog {...defaultProps} open={true} onClose={onClose} />);
    const dialog = screen.getByTestId("lead-all-dialog");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("onCancel calls onClose (Escape key)", () => {
    const onClose = vi.fn();
    render(<LeadAllDialog {...defaultProps} open={true} onClose={onClose} />);
    const dialog = screen.getByTestId("lead-all-dialog");
    fireEvent(dialog, new Event("cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Content not rendered when closed
// ---------------------------------------------------------------------------

describe("LeadAllDialog closed state", () => {
  it("does not render profile list when closed", () => {
    render(<LeadAllDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId("profile-list")).toBeNull();
  });

  it("does not render confirm button when closed", () => {
    render(<LeadAllDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId("confirm-button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Profile list
// ---------------------------------------------------------------------------

describe("LeadAllDialog profile list", () => {
  it("renders a checkbox for each profile", () => {
    render(<LeadAllDialog {...defaultProps} open={true} />);
    expect(screen.getByTestId("profile-list")).toBeTruthy();
    expect(
      screen.getByTestId("profile-checkbox-agent-1/default")
    ).toBeTruthy();
    expect(screen.getByTestId("profile-checkbox-agent-2/fast")).toBeTruthy();
  });

  it("shows loading message when agents are loading", () => {
    mockUseAgents.mockReturnValue({ agents: [], loading: true, error: null });
    mockUseAgentProfiles.mockReturnValue([]);
    render(<LeadAllDialog {...defaultProps} open={true} />);
    expect(screen.getByText("Loading agents…")).toBeTruthy();
  });

  it("shows error message when agents fail to load", () => {
    mockUseAgents.mockReturnValue({
      agents: [],
      loading: false,
      error: "Failed to fetch agents",
    });
    mockUseAgentProfiles.mockReturnValue([]);
    render(<LeadAllDialog {...defaultProps} open={true} />);
    expect(screen.getByText("Failed to fetch agents")).toBeTruthy();
  });

  it("shows no-repo message when repoUrl is undefined", () => {
    mockUseAgentProfiles.mockReturnValue([]);
    render(<LeadAllDialog {...defaultProps} open={true} repoUrl={undefined} />);
    expect(
      screen.getByText("No repository configured for this project.")
    ).toBeTruthy();
  });

  it("shows no-agents message when profiles list is empty", () => {
    mockUseAgentProfiles.mockReturnValue([]);
    render(<LeadAllDialog {...defaultProps} open={true} />);
    expect(
      screen.getByText(
        "No online agents with profiles matching this repository."
      )
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Confirm button disabled state
// ---------------------------------------------------------------------------

describe("LeadAllDialog confirm button disabled state", () => {
  it("confirm button is disabled when no profiles are selected", () => {
    render(<LeadAllDialog {...defaultProps} open={true} />);
    const btn = screen.getByTestId("confirm-button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("confirm button is disabled when tickets list is empty", () => {
    render(<LeadAllDialog {...defaultProps} open={true} tickets={[]} />);
    const btn = screen.getByTestId("confirm-button");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("confirm button is enabled after selecting a profile", () => {
    render(<LeadAllDialog {...defaultProps} open={true} />);
    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    const btn = screen.getByTestId("confirm-button");
    expect(btn.hasAttribute("disabled")).toBe(false);
  });

  it("confirm button label shows ticket count", () => {
    const tickets = [makeTicket({ number: 1 }), makeTicket({ id: "t2", number: 2 })];
    render(<LeadAllDialog {...defaultProps} open={true} tickets={tickets} />);
    expect(screen.getByTestId("confirm-button").textContent).toBe("Lead All (2)");
  });
});

// ---------------------------------------------------------------------------
// Confirm launches sessions
// ---------------------------------------------------------------------------

describe("LeadAllDialog confirm launches sessions", () => {
  it("calls createSession for each ticket with a selected profile", async () => {
    const tickets = [
      makeTicket({ number: 10 }),
      makeTicket({ id: "t2", number: 20 }),
    ];
    const onClose = vi.fn();
    mockCreateSession.mockResolvedValue({} as never);

    render(
      <LeadAllDialog
        {...defaultProps}
        open={true}
        tickets={tickets}
        onClose={onClose}
        projectId="proj"
      />
    );

    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-button"));
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    // Both tickets should use the only selected profile (agent-1/default)
    expect(mockCreateSession).toHaveBeenCalledWith(
      "agent-1",
      "default",
      "proj-lead-10",
      ["/lead 10"]
    );
    expect(mockCreateSession).toHaveBeenCalledWith(
      "agent-1",
      "default",
      "proj-lead-20",
      ["/lead 20"]
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("session name uses bare prefix when projectId is undefined", async () => {
    mockCreateSession.mockResolvedValue({} as never);
    render(
      <LeadAllDialog
        {...defaultProps}
        open={true}
        projectId={undefined}
        tickets={[makeTicket({ number: 5 })]}
      />
    );
    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-button"));
    });
    expect(mockCreateSession).toHaveBeenCalledWith(
      "agent-1",
      "default",
      "lead-5",
      ["/lead 5"]
    );
  });

  it("shows launch error when all sessions fail", async () => {
    mockCreateSession.mockRejectedValue(new Error("Network error"));
    render(<LeadAllDialog {...defaultProps} open={true} />);
    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-button"));
    });
    expect(screen.getByTestId("launch-error").textContent).toBe("Network error");
  });

  it("does not close dialog when all sessions fail", async () => {
    const onClose = vi.fn();
    mockCreateSession.mockRejectedValue(new Error("oops"));
    render(
      <LeadAllDialog {...defaultProps} open={true} onClose={onClose} />
    );
    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-button"));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows partial-failure message when some sessions fail", async () => {
    const tickets = [
      makeTicket({ number: 1 }),
      makeTicket({ id: "t2", number: 2 }),
      makeTicket({ id: "t3", number: 3 }),
    ];
    mockCreateSession
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce({} as never);
    const onClose = vi.fn();
    render(
      <LeadAllDialog
        {...defaultProps}
        open={true}
        tickets={tickets}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId("profile-checkbox-agent-1/default"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-button"));
    });
    expect(screen.getByTestId("launch-error").textContent).toContain("1 of 3");
    expect(screen.getByTestId("launch-error").textContent).toContain("Timeout");
    expect(onClose).not.toHaveBeenCalled();
  });
});

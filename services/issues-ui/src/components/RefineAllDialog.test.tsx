// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { Session } from "../types";

// Mock CSS modules — must come before component imports
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));

// Stub AgentLauncher so tests can control when onLaunched fires without
// needing a real agent hub connection. The stub also exposes sessionName
// as a data attribute and a trigger button to simulate a successful launch.
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: (props: {
    ticketNumber: number;
    repoUrl: string | undefined;
    onLaunched: (session: Session, agentName: string) => void;
    command?: string;
    sessionName?: string;
    buttonLabel?: string;
  }) => (
    <div
      data-testid="agent-launcher"
      data-command={props.command}
      data-session-name={props.sessionName}
    >
      <button
        data-testid="agent-launcher-trigger"
        onClick={() =>
          props.onLaunched({ id: "sess-1" } as Session, "test-agent")
        }
      >
        {props.buttonLabel ?? "Launch"}
      </button>
    </div>
  ),
}));

import { RefineAllDialog } from "./RefineAllDialog";

// ---------------------------------------------------------------------------
// jsdom dialog polyfill
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.restoreAllMocks();
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  repoUrl: "https://github.com/org/repo",
  open: true,
  onClose: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RefineAllDialog", () => {
  it("does not render AgentLauncher when open={false}", () => {
    render(<RefineAllDialog {...defaultProps} open={false} />);

    expect(screen.queryByTestId("agent-launcher")).toBeNull();
  });

  it("renders AgentLauncher when open={true}", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);

    expect(screen.getByTestId("agent-launcher")).not.toBeNull();
  });

  it("calls onClose when the X button is clicked", () => {
    const onClose = vi.fn();
    render(<RefineAllDialog {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByTestId("dialog-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on backdrop click (target === dialog element itself)", () => {
    const onClose = vi.fn();
    render(<RefineAllDialog {...defaultProps} onClose={onClose} />);

    const dialog = screen.getByTestId("refine-all-dialog");
    // Simulate a click directly on the dialog element (the backdrop area
    // outside the content box). fireEvent sets target === currentTarget === dialog.
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls showModal when open transitions to true", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("does not call showModal when open={false}", () => {
    render(<RefineAllDialog {...defaultProps} open={false} />);

    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it("calls onClose after handleLaunched fires via AgentLauncher stub", () => {
    const onClose = vi.fn();
    render(<RefineAllDialog {...defaultProps} onClose={onClose} />);

    act(() => {
      fireEvent.click(screen.getByTestId("agent-launcher-trigger"));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("session name includes projectId prefix when projectId is provided", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);

    render(
      <RefineAllDialog
        {...defaultProps}
        open={true}
        projectId="my-project"
      />,
    );

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-session-name")).toBe(
      "my-project-refine-all-12345",
    );
  });

  it("session name omits prefix when projectId is not provided", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);

    render(<RefineAllDialog {...defaultProps} open={true} />);

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-session-name")).toBe("refine-all-12345");
  });
});

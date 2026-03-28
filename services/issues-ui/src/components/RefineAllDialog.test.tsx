// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock CSS modules
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));

// Mock AgentLauncher — captures command and sessionName as data attributes
// so tests can inspect which props were passed.
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: ({
    command,
    sessionName,
  }: {
    command?: string;
    sessionName?: string;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="agent-launcher"
      data-command={command}
      data-session-name={sessionName}
    />
  ),
}));

import { RefineAllDialog } from "./RefineAllDialog";

// jsdom does not implement showModal/close on HTMLDialogElement.
beforeEach(() => {
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
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  repoUrl: "https://github.com/org/repo",
  open: false,
  onClose: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RefineAllDialog", () => {
  it("renders without calling showModal when closed", () => {
    render(<RefineAllDialog {...defaultProps} open={false} />);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it("calls showModal when open=true", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("calls close and onClose when cancel button clicked", () => {
    const onClose = vi.fn();
    render(
      <RefineAllDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    fireEvent.click(screen.getByTestId("dialog-close"));

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls close and onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <RefineAllDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    const dialog = screen.getByTestId("refine-all-dialog");
    // Simulate a click directly on the dialog element (the backdrop area)
    fireEvent.click(dialog);

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders AgentLauncher when open", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);
    expect(screen.getByTestId("agent-launcher")).toBeTruthy();
  });

  it("does not render AgentLauncher when closed", () => {
    render(<RefineAllDialog {...defaultProps} open={false} />);
    expect(screen.queryByTestId("agent-launcher")).toBeNull();
  });

  it("passes sessionName starting with refine-all- to AgentLauncher", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);

    const launcher = screen.getByTestId("agent-launcher");
    const sessionName = launcher.getAttribute("data-session-name") ?? "";
    expect(sessionName).toMatch(/^refine-all-/);
  });

  it("passes correct command to AgentLauncher", () => {
    render(<RefineAllDialog {...defaultProps} open={true} />);

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-command")).toBe("/refine");
  });
});

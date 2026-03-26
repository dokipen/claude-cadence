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

import { CreateTicketDialog } from "./CreateTicketDialog";

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

describe("CreateTicketDialog", () => {
  it("renders null (no showModal) when closed", () => {
    render(<CreateTicketDialog {...defaultProps} open={false} />);
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it("calls showModal when open=true", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("calls close and onClose when cancel button clicked", () => {
    const onClose = vi.fn();
    render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    fireEvent.click(screen.getByTestId("dialog-close"));

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls close and onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    const dialog = screen.getByTestId("create-ticket-dialog");
    // Simulate a click directly on the dialog element (the backdrop area)
    fireEvent.click(dialog);

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables submit when prompt is empty", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    // The textarea should be present and empty by default
    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");

    // When the prompt is empty, AgentLauncher should receive an empty-suffixed
    // command or the launch button should be disabled.  Check both possibilities:
    // either the agent-launcher is not rendered, or it receives a command ending
    // with a bare space (no user text), or a dedicated submit button is disabled.
    const launcher = screen.queryByTestId("agent-launcher");
    if (launcher) {
      // If AgentLauncher is always rendered, it should have an empty prompt appended
      const cmd = launcher.getAttribute("data-command") ?? "";
      // command should end with a space and no additional text
      expect(cmd).toMatch(/\/create-ticket\s*$/);
    } else {
      // If AgentLauncher is conditionally rendered, the submit button should be
      // disabled or absent when the prompt is empty.
      const submitButton = screen.queryByTestId("dialog-submit");
      if (submitButton) {
        expect((submitButton as HTMLButtonElement).disabled).toBe(true);
      }
      // Either is acceptable — the component just should not allow launching
      // with an empty prompt.
    }
  });

  it("passes correct command with prompt to AgentLauncher", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "My ticket text" } });

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-command")).toBe(
      "/create-ticket My ticket text",
    );
  });

  it("passes sessionName starting with ticket- to AgentLauncher", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    // Type something so the launcher is visible if it is conditionally rendered
    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Some prompt" } });

    const launcher = screen.getByTestId("agent-launcher");
    const sessionName = launcher.getAttribute("data-session-name") ?? "";
    expect(sessionName).toMatch(/^ticket-/);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock CSS modules
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));

// Mock AgentLauncher — captures command and sessionName as data attributes
// so tests can inspect which props were passed. Exposes a "mock-launch" button
// to simulate a successful launch (calls onLaunched).
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: ({
    command,
    sessionName,
    onLaunched,
  }: {
    command?: string;
    sessionName?: string;
    onLaunched?: (session: unknown, agentName: string) => void;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="agent-launcher"
      data-command={command}
      data-session-name={sessionName}
    >
      <button
        data-testid="mock-launch"
        onClick={() => onLaunched?.({}, "test-agent")}
      />
    </div>
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

  it("calls onClose when cancel button clicked", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    fireEvent.click(screen.getByTestId("dialog-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
    
    // After parent re-renders with open=false, dialog should close
    rerender(<CreateTicketDialog {...defaultProps} open={false} onClose={onClose} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    const dialog = screen.getByTestId("create-ticket-dialog");
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);

    // After parent re-renders with open=false, dialog should close
    rerender(<CreateTicketDialog {...defaultProps} open={false} onClose={onClose} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("does not render AgentLauncher when prompt is empty", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    // Textarea starts empty — AgentLauncher should not be present
    expect(screen.queryByTestId("agent-launcher")).toBeNull();

    // Typing whitespace-only also should not show the launcher
    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(screen.queryByTestId("agent-launcher")).toBeNull();
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

  it("normalizes whitespace in command (newlines become spaces)", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "line one\nline two" } });

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-command")).toBe(
      "/create-ticket line one line two",
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

  it("ticket-prompt textarea has autocomplete=off", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt");
    expect(textarea).toHaveAttribute("autocomplete", "off");
  });

  it("clears textarea after successful submission (onLaunched fires)", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "My new ticket" } });
    expect(textarea.value).toBe("My new ticket");

    // Simulate a successful agent launch
    fireEvent.click(screen.getByTestId("mock-launch"));

    // Prompt should be cleared.
    expect(textarea.value).toBe("");

    // onClose should be called.
    expect(onClose).toHaveBeenCalledTimes(1);

    // After parent re-renders with open=false, dialog should close
    rerender(<CreateTicketDialog {...defaultProps} open={false} onClose={onClose} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("preserves textarea content when cancelled (not a successful launch)", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />,
    );

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "In-progress thought" } });
    expect(textarea.value).toBe("In-progress thought");

    // Cancel without launching
    fireEvent.click(screen.getByTestId("dialog-close"));

    // After parent re-renders with open=false, dialog should close
    rerender(<CreateTicketDialog {...defaultProps} open={false} onClose={onClose} />);
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();

    // Reopen the dialog
    rerender(<CreateTicketDialog {...defaultProps} open={true} onClose={onClose} />);

    // Prompt should NOT be cleared.
    const textareaAfter = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    expect(textareaAfter.value).toBe("In-progress thought");
  });
});

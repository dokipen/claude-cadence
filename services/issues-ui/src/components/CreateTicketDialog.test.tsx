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

  it("strips non-whitespace control characters from command", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    // \x07 is BEL, \x1B is ESC, \x7F is DEL
    fireEvent.change(textarea, {
      target: { value: "clean\x07 text\x1B with\x7F controls" },
    });

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-command")).toBe(
      "/create-ticket clean text with controls",
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

  it("strips control characters from prompt before building command", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "hello\x00\x01\x1bworld\x7f" },
    });

    const launcher = screen.getByTestId("agent-launcher");
    expect(launcher.getAttribute("data-command")).toBe(
      "/create-ticket helloworld",
    );
  });

  it("does not render AgentLauncher when prompt contains only control characters", () => {
    render(<CreateTicketDialog {...defaultProps} open={true} />);

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "\x00\x01\x1b\x7f" } });

    expect(screen.queryByTestId("agent-launcher")).toBeNull();
  });

  it("sanitizes invalid characters from projectId in sessionName", () => {
    render(
      <CreateTicketDialog
        {...defaultProps}
        open={true}
        projectId="my project/id!"
      />,
    );

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Some prompt" } });

    const launcher = screen.getByTestId("agent-launcher");
    const sessionName = launcher.getAttribute("data-session-name") ?? "";
    expect(sessionName).toMatch(/^myprojectid-ticket-/);
  });

  it("passes sessionName with valid projectId prefix to AgentLauncher", () => {
    render(
      <CreateTicketDialog
        {...defaultProps}
        open={true}
        projectId="my-project"
      />,
    );

    const textarea = screen.getByTestId("ticket-prompt") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Some prompt" } });

    const launcher = screen.getByTestId("agent-launcher");
    const sessionName = launcher.getAttribute("data-session-name") ?? "";
    expect(sessionName).toMatch(/^my-project-ticket-/);
  });
});

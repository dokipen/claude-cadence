// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Mock CSS modules — must come before imports
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));

import { ConfirmDialog } from "./ConfirmDialog";

// jsdom does not implement showModal/close on HTMLDialogElement.
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
  open: true,
  title: "Delete item?",
  message: "This action cannot be undone.",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfirmDialog", () => {
  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when X (close) button is clicked", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("confirm-dialog-cancel-x"));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel on backdrop click (target === dialog element itself)", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    const dialog = screen.getByTestId("confirm-dialog");
    // Fire click where target and currentTarget are both the dialog element,
    // simulating a click on the backdrop area outside the content.
    fireEvent.click(dialog);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not render content when open prop is false", () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);

    expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    expect(screen.queryByTestId("confirm-dialog-cancel")).toBeNull();
    expect(screen.queryByTestId("confirm-dialog-cancel-x")).toBeNull();
  });

  it("renders content when open prop is true", () => {
    render(<ConfirmDialog {...defaultProps} open={true} />);

    expect(screen.getByTestId("confirm-dialog-confirm")).not.toBeNull();
    expect(screen.getByTestId("confirm-dialog-cancel")).not.toBeNull();
    expect(screen.queryByText("Delete item?")).not.toBeNull();
    expect(screen.queryByText("This action cannot be undone.")).not.toBeNull();
  });

  it("calls showModal when open transitions to true", () => {
    render(<ConfirmDialog {...defaultProps} open={true} />);

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("does not call showModal when open is false", () => {
    render(<ConfirmDialog {...defaultProps} open={false} />);

    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it("calls close when open transitions from true to false", () => {
    const { rerender } = render(
      <ConfirmDialog {...defaultProps} open={true} />,
    );

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);

    rerender(<ConfirmDialog {...defaultProps} open={false} />);

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });

  it("renders custom confirmLabel when provided", () => {
    render(
      <ConfirmDialog {...defaultProps} open={true} confirmLabel="Delete" />,
    );

    expect(screen.getByTestId("confirm-dialog-confirm").textContent).toBe(
      "Delete",
    );
  });

  it('renders default "Confirm" label when confirmLabel is omitted', () => {
    render(<ConfirmDialog {...defaultProps} open={true} />);

    expect(screen.getByTestId("confirm-dialog-confirm").textContent).toBe(
      "Confirm",
    );
  });

  it('positions the dialog with fixed style when anchorRect is provided', async () => {
    const mockAnchorRect = {
      bottom: 100,
      top: 80,
      left: 50,
      right: 100,
      width: 50,
      height: 20,
      x: 50,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect;

    // Flush requestAnimationFrame callbacks synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    render(
      <ConfirmDialog
        open={true}
        title="Kill session?"
        message="Terminate the agent?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        anchorRect={mockAnchorRect}
      />,
    );

    const dialog = screen.getByTestId('confirm-dialog');
    // The dialog should be positioned with fixed layout when anchorRect is provided
    expect(dialog.style.position).toBe('fixed');
  });

});

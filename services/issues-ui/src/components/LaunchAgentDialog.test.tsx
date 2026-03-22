// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

// Mock CSS modules
vi.mock("../styles/dialog.module.css", () => ({ default: {} }));

// Mock AgentLauncher to avoid deep dependency chains
vi.mock("./AgentLauncher", () => ({
  AgentLauncher: () => <div data-testid="agent-launcher" />,
}));

import { LaunchAgentDialog } from "./LaunchAgentDialog";

// jsdom does not implement showModal/close on HTMLDialogElement.
// Our mock for showModal sets the `open` attribute to simulate native behaviour
// so that el.open === true after calling showModal.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    bottom: 100,
    top: 80,
    left: 50,
    right: 150,
    width: 100,
    height: 20,
    x: 50,
    y: 80,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

const defaultProps = {
  ticketNumber: 42,
  repoUrl: "https://github.com/org/repo",
  onClose: vi.fn(),
  ticketState: "REFINED" as const,
  ticketTitle: "Test ticket",
};

// ---------------------------------------------------------------------------
// Positioning tests
// ---------------------------------------------------------------------------

describe("LaunchAgentDialog positioning", () => {
  it("sets top style when open=true and anchorRect is provided", () => {
    const anchorRect = makeRect({ bottom: 100, left: 50 });

    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    // bottom=100, gap=8 => top should be 108px
    expect(dialog.style.top).toBe("108px");
  });

  it("sets left style when open=true and anchorRect is provided", () => {
    const anchorRect = makeRect({ bottom: 100, left: 50 });

    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    // left=50, dialogWidth=0 (jsdom default), no right overflow => left stays 50px
    expect(dialog.style.left).toBe("50px");
  });

  it("sets position=fixed when open=true with anchorRect", () => {
    const anchorRect = makeRect({ bottom: 100, left: 50 });

    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    expect(dialog.style.position).toBe("fixed");
  });

  it("sets margin to 0px when open=true with anchorRect", () => {
    const anchorRect = makeRect({ bottom: 100, left: 50 });

    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    // jsdom normalises "0" to "0px" when set via el.style.margin
    expect(dialog.style.margin).toBe("0px");
  });

  it("does NOT set inline top/left when open=true and no anchorRect is provided", () => {
    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={undefined} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    expect(dialog.style.top).toBe("");
    expect(dialog.style.left).toBe("");
  });

  it("does NOT set position or margin when open=true and no anchorRect is provided", () => {
    const { getByTestId } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={undefined} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    expect(dialog.style.position).toBe("");
    expect(dialog.style.margin).toBe("");
  });

  it("clears inline position styles when open becomes false", async () => {
    // Override close so it does NOT remove the open attribute — this keeps
    // el.open === true when the rerender runs, allowing the style-clearing
    // branch in the component to execute before close() is called.
    HTMLDialogElement.prototype.close = vi.fn();

    const anchorRect = makeRect({ bottom: 100, left: 50 });

    const { getByTestId, rerender } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
    );

    const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
    // Verify styles were applied while open
    expect(dialog.style.top).toBe("108px");

    await act(async () => {
      rerender(
        <LaunchAgentDialog {...defaultProps} open={false} anchorRect={anchorRect} />,
      );
    });

    // After closing, styles should be cleared
    expect(dialog.style.top).toBe("");
    expect(dialog.style.left).toBe("");
    expect(dialog.style.position).toBe("");
    expect(dialog.style.margin).toBe("");
  });

  it("calls showModal when open=true", () => {
    render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={undefined} />,
    );

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  });

  it("calls close when open transitions from true to false", async () => {
    const { rerender } = render(
      <LaunchAgentDialog {...defaultProps} open={true} anchorRect={undefined} />,
    );

    await act(async () => {
      rerender(
        <LaunchAgentDialog {...defaultProps} open={false} anchorRect={undefined} />,
      );
    });

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Viewport clamping tests
// ---------------------------------------------------------------------------

describe("LaunchAgentDialog viewport clamping", () => {
  it("clamps left when dialog would overflow the right edge", () => {
    // window.innerWidth defaults to 1024 in jsdom
    // anchorRect.left=980, dialogWidth=200 => 980+200=1180 > 1024-8=1016
    // clamped left = 1024 - 200 - 8 = 816
    const anchorRect = makeRect({ bottom: 100, left: 980, top: 80 });

    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        if ((this as HTMLElement).tagName === "DIALOG") return 200;
        return 0;
      },
    });

    try {
      const { getByTestId } = render(
        <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
      );

      const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
      expect(dialog.style.left).toBe("816px");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get() {
          return 0;
        },
      });
    }
  });

  it("clamps left to the minimum gap when computed left goes below gap", () => {
    // left=0, dialogWidth=1100 => 0+1100 > 1024-8=1016
    // clamped: 1024 - 1100 - 8 = -84 => below gap(8) => floor at 8
    const anchorRect = makeRect({ bottom: 100, left: 0, top: 80 });

    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        if ((this as HTMLElement).tagName === "DIALOG") return 1100;
        return 0;
      },
    });

    try {
      const { getByTestId } = render(
        <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
      );

      const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
      expect(dialog.style.left).toBe("8px");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get() {
          return 0;
        },
      });
    }
  });

  it("flips dialog above the anchor when it would overflow the bottom edge", () => {
    // window.innerHeight defaults to 768 in jsdom
    // anchorRect.bottom=730, gap=8 => initial top = 738
    // dialogHeight=100 => 738+100=838 > 768-8=760 => flip
    // flipped top = anchorRect.top(710) - dialogHeight(100) - gap(8) = 602
    const anchorRect = makeRect({ bottom: 730, top: 710, left: 50 });

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if ((this as HTMLElement).tagName === "DIALOG") return 100;
        return 0;
      },
    });

    try {
      const { getByTestId } = render(
        <LaunchAgentDialog {...defaultProps} open={true} anchorRect={anchorRect} />,
      );

      const dialog = getByTestId("launch-agent-dialog") as HTMLDialogElement;
      expect(dialog.style.top).toBe("602px");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          return 0;
        },
      });
    }
  });
});

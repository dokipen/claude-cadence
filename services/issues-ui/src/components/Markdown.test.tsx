// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Component } from "react";
import type { ReactNode } from "react";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Shared test error boundary (mirrors the real MarkdownErrorBoundary)
// ---------------------------------------------------------------------------

class TestErrorBoundary extends Component<
  { fallback: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <span style={{ whiteSpace: "pre-wrap" }}>{this.props.fallback}</span>
      );
    }
    return this.props.children;
  }
}

function ThrowingChild(): never {
  throw new Error("render error");
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

describe("Markdown rendering", () => {
  it("renders a heading from markdown", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(<Markdown>{"# Hello"}</Markdown>);
    const h1 = container.querySelector("h1");
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe("Hello");
  });

  it("renders bold text from markdown", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(<Markdown>{"**bold**"}</Markdown>);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold");
  });

  it("renders italic text from markdown", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(<Markdown>{"_italic_"}</Markdown>);
    const em = container.querySelector("em");
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe("italic");
  });

  it("renders a paragraph for plain text", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(<Markdown>{"plain text"}</Markdown>);
    const p = container.querySelector("p");
    expect(p).not.toBeNull();
    expect(p?.textContent).toBe("plain text");
  });
});

// ---------------------------------------------------------------------------
// Link attributes
// ---------------------------------------------------------------------------

describe("Markdown link attributes", () => {
  it("adds target=_blank to links", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(
      <Markdown>{"[click here](https://example.com)"}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("target")).toBe("_blank");
  });

  it("adds rel=noopener noreferrer to links", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(
      <Markdown>{"[click here](https://example.com)"}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("preserves the href of links", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(
      <Markdown>{"[docs](https://docs.example.com/path)"}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://docs.example.com/path");
  });

  it("uses the link text as the anchor content", async () => {
    const { Markdown } = await import("./Markdown");
    const { container } = render(
      <Markdown>{"[my link text](https://example.com)"}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a?.textContent).toBe("my link text");
  });
});

// ---------------------------------------------------------------------------
// Error boundary — MarkdownErrorBoundary fallback
// ---------------------------------------------------------------------------

describe("MarkdownErrorBoundary fallback", () => {
  beforeEach(() => {
    // Suppress React's expected error boundary console output
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the fallback span when a child throws", () => {
    const { getByText } = render(
      <TestErrorBoundary fallback="raw markdown content">
        <ThrowingChild />
      </TestErrorBoundary>,
    );

    const fallback = getByText("raw markdown content");
    expect(fallback.tagName.toLowerCase()).toBe("span");
    expect(fallback.style.whiteSpace).toBe("pre-wrap");
  });

  it("renders children normally when no error is thrown", () => {
    const { getByText, queryByText } = render(
      <TestErrorBoundary fallback="fallback text">
        <div>child content</div>
      </TestErrorBoundary>,
    );

    expect(getByText("child content")).not.toBeNull();
    expect(queryByText("fallback text")).toBeNull();
  });
});

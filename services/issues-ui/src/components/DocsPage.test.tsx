// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// --- Mock hooks before any imports that use them ---
vi.mock("../hooks/useDocs", () => ({
  useDocFiles: vi.fn(),
  useDocContent: vi.fn(),
}));

// Mock react-router hooks
const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useParams: vi.fn(),
  useNavigate: vi.fn(),
}));

// Mock child components that have complex dependencies
vi.mock("./Markdown", () => ({
  Markdown: ({ children }: { children: string }) => <div>{children}</div>,
}));

// Mock CSS modules
vi.mock("../styles/docs.module.css", () => ({ default: {} }));

import { DocsPage } from "./DocsPage";
import { useDocFiles, useDocContent } from "../hooks/useDocs";
import { useParams, useNavigate } from "react-router";

const mockUseDocFiles = useDocFiles as ReturnType<typeof vi.fn>;
const mockUseDocContent = useDocContent as ReturnType<typeof vi.fn>;
const mockUseParams = useParams as ReturnType<typeof vi.fn>;
const mockUseNavigate = useNavigate as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();

  // Default: no file selected, files loaded
  mockUseParams.mockReturnValue({ "*": "" });
  mockUseNavigate.mockReturnValue(mockNavigate);
  mockUseDocFiles.mockReturnValue({
    files: [
      { path: "getting-started.md", name: "Getting Started" },
      { path: "api-reference.md", name: "API Reference" },
    ],
    loading: false,
    error: null,
  });
  mockUseDocContent.mockReturnValue({ content: null, loading: false, error: null });
});

afterEach(() => {
  cleanup();
});

describe("DocsPage", () => {
  it("calls navigate with the correct path when a file button is clicked", () => {
    render(<DocsPage />);

    const fileButton = screen.getByText("getting-started.md");
    fireEvent.click(fileButton);

    expect(mockNavigate).toHaveBeenCalledWith("/docs/getting-started.md");
  });

  it("passes the path from useParams to useDocContent for deep-link initialization", () => {
    mockUseParams.mockReturnValue({ "*": "some/path.md" });
    mockUseDocContent.mockReturnValue({ content: "# Deep linked content", loading: false, error: null });

    render(<DocsPage />);

    expect(mockUseDocContent).toHaveBeenCalledWith("some/path.md");
  });
});

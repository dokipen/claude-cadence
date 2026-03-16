// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ProjectSelector, STORAGE_KEY } from "./ProjectSelector";
import type { Project } from "../types";

// Mock the useProjects hook
vi.mock("../hooks/useProjects", () => ({
  useProjects: vi.fn(),
}));

// Mock CSS modules
vi.mock("../styles/layout.module.css", () => ({ default: {} }));

import { useProjects } from "../hooks/useProjects";

const mockUseProjects = useProjects as ReturnType<typeof vi.fn>;

const PROJECTS: Project[] = [
  { id: "proj-a", name: "Project A" },
  { id: "proj-b", name: "Project B" },
];

// Stub localStorage since jsdom's implementation may vary across environments
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("localStorage", localStorageMock);
  localStorageMock.clear();
  mockUseProjects.mockReturnValue({
    projects: PROJECTS,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("ProjectSelector handleChange validation", () => {
  it("does NOT update localStorage when selected value is not in projects list", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    // Simulate a change event with a value not in the projects list
    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "proj-evil" },
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does NOT call onProjectChange with an invalid id when selected value is not in projects list", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    // Clear any calls from the auto-select useEffect
    onProjectChange.mockClear();

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "injected-id" },
    });

    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it("updates localStorage when selected value IS in projects list", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "proj-b" },
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBe("proj-b");
  });

  it("calls onProjectChange with the new id when selected value IS in projects list", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    // Clear any calls from the auto-select useEffect
    onProjectChange.mockClear();

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "proj-b" },
    });

    expect(onProjectChange).toHaveBeenCalledWith("proj-b");
    expect(onProjectChange).toHaveBeenCalledTimes(1);
  });
});

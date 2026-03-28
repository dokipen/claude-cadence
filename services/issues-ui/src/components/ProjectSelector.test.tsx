// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ProjectSelector } from "./ProjectSelector";
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

beforeEach(() => {
  vi.restoreAllMocks();
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
  it("does NOT call onProjectChange with an invalid id", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    // Clear any calls from the auto-select useEffect
    onProjectChange.mockClear();

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "proj-evil" },
    });

    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it("does NOT call onProjectChange with a path-traversal id", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    onProjectChange.mockClear();

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "../../../etc/passwd" },
    });

    expect(onProjectChange).not.toHaveBeenCalled();
  });

  it("calls onProjectChange when selected value IS in projects list", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    onProjectChange.mockClear();

    fireEvent.change(getByTestId("project-selector"), {
      target: { value: "proj-b" },
    });

    expect(onProjectChange).toHaveBeenCalledWith("proj-b");
    expect(onProjectChange).toHaveBeenCalledTimes(1);
  });

  it("auto-redirects to first project when selectedProjectId is invalid", () => {
    const onProjectChange = vi.fn();
    render(
      <ProjectSelector selectedProjectId="nonexistent" onProjectChange={onProjectChange} />,
    );

    expect(onProjectChange).toHaveBeenCalledWith("proj-a");
  });
});

describe("ProjectSelector autocomplete attributes", () => {
  it("project-selector select has autocomplete=off", () => {
    const onProjectChange = vi.fn();
    const { getByTestId } = render(
      <ProjectSelector selectedProjectId="proj-a" onProjectChange={onProjectChange} />,
    );

    const projectSelect = getByTestId("project-selector");
    expect(projectSelect).toHaveAttribute("autocomplete", "off");
  });
});

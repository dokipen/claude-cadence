// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STORAGE_KEY, PROJECT_ID_RE } from "./App";
import { makeSessionStorageMock } from './test-utils/sessionStorageMock';
const PROJECTS = [
  { id: "proj-a", name: "Project A" },
  { id: "proj-b", name: "Project B" },
  { id: "my_project", name: "My Project" },
];

function resolveTargetProject(projects: typeof PROJECTS): string {
  let savedId = sessionStorage.getItem(STORAGE_KEY);
  if (savedId !== null && !PROJECT_ID_RE.test(savedId)) savedId = null;
  return savedId && projects.some((p) => p.id === savedId)
    ? savedId
    : projects[0].id;
}

let mockStorage: ReturnType<typeof makeSessionStorageMock>;

beforeEach(() => {
  mockStorage = makeSessionStorageMock();
  vi.stubGlobal("sessionStorage", mockStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectRedirect sessionStorage resolution", () => {
  it("redirects to saved project when ID is valid", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj-b");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-b");
  });

  it("falls back to first project when saved ID is not in list", () => {
    sessionStorage.setItem(STORAGE_KEY, "deleted-project");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("falls back to first project when no ID is saved", () => {
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });
});

describe("ProjectRedirect format validation", () => {
  it("accepts a valid project ID with underscores (verifies \\w includes underscore)", () => {
    sessionStorage.setItem(STORAGE_KEY, "my_project");
    expect(resolveTargetProject(PROJECTS)).toBe("my_project");
  });

  it("rejects an ID with path-traversal characters", () => {
    sessionStorage.setItem(STORAGE_KEY, "../../../etc/passwd");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("rejects an ID with angle brackets", () => {
    sessionStorage.setItem(STORAGE_KEY, "<script>alert(1)</script>");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("rejects an ID with spaces", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj a");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });
});

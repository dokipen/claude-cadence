// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STORAGE_KEY } from "./App";
const PROJECTS = [
  { id: "proj-a", name: "Project A" },
  { id: "proj-b", name: "Project B" },
];

function resolveTargetProject(projects: typeof PROJECTS): string {
  const savedId = sessionStorage.getItem(STORAGE_KEY);
  return savedId && projects.some((p) => p.id === savedId)
    ? savedId
    : projects[0].id;
}

function makeSessionStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

let mockStorage: ReturnType<typeof makeSessionStorageMock>;

beforeEach(() => {
  mockStorage = makeSessionStorageMock();
  vi.stubGlobal("sessionStorage", mockStorage);
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

describe("handleProjectChange sessionStorage persistence", () => {
  it("writes project ID to sessionStorage", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj-b");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("proj-b");
  });

  it("overwrites previous project ID", () => {
    sessionStorage.setItem(STORAGE_KEY, "proj-a");
    sessionStorage.setItem(STORAGE_KEY, "proj-b");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe("proj-b");
  });
});

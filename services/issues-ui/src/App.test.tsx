// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { STORAGE_KEY } from "./App";
const PROJECTS = [
  { id: "proj-a", name: "Project A" },
  { id: "proj-b", name: "Project B" },
];

function resolveTargetProject(projects: typeof PROJECTS): string {
  const savedId = localStorage.getItem(STORAGE_KEY);
  return savedId && projects.some((p) => p.id === savedId)
    ? savedId
    : projects[0].id;
}

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

let mockStorage: ReturnType<typeof makeLocalStorageMock>;

beforeEach(() => {
  mockStorage = makeLocalStorageMock();
  vi.stubGlobal("localStorage", mockStorage);
});

describe("ProjectRedirect localStorage resolution", () => {
  it("redirects to saved project when ID is valid", () => {
    localStorage.setItem(STORAGE_KEY, "proj-b");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-b");
  });

  it("falls back to first project when saved ID is not in list", () => {
    localStorage.setItem(STORAGE_KEY, "deleted-project");
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });

  it("falls back to first project when no ID is saved", () => {
    expect(resolveTargetProject(PROJECTS)).toBe("proj-a");
  });
});

describe("handleProjectChange localStorage persistence", () => {
  it("writes project ID to localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "proj-b");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("proj-b");
  });

  it("overwrites previous project ID", () => {
    localStorage.setItem(STORAGE_KEY, "proj-a");
    localStorage.setItem(STORAGE_KEY, "proj-b");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("proj-b");
  });
});

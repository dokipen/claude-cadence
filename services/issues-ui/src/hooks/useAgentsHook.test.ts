// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAgents } from "./useAgents";
import { fetchAgents } from "../api/agentHubClient";

vi.mock("../api/agentHubClient", () => ({
  fetchAgents: vi.fn(),
}));

vi.mock("./usePageVisibility", () => ({
  usePageVisibility: vi.fn(() => false),
}));

describe("useAgents sorting", () => {
  it("sorts agents alphabetically by name", async () => {
    const mockFetchAgents = vi.mocked(fetchAgents);
    mockFetchAgents.mockResolvedValueOnce({
      agents: [
        { name: "zebra", status: "online", profiles: {} },
        { name: "alpha", status: "online", profiles: {} },
        { name: "Charlie", status: "online", profiles: {} },
      ],
    } as any);

    const { result } = renderHook(() => useAgents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents.map((a: any) => a.name)).toEqual(["alpha", "Charlie", "zebra"]);
  });
});
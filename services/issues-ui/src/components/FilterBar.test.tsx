// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// vi.mock calls come BEFORE imports (Vitest hoists them)
vi.mock("../styles/filter.module.css", () => ({ default: {} }));
vi.mock("../hooks/useLabels", () => ({
  useLabels: vi.fn(),
}));
import { render, cleanup, fireEvent } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { useLabels } from "../hooks/useLabels";
const mockUseLabels = useLabels as ReturnType<typeof vi.fn>;

function makeLocalStorageMock() {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
}

let mockLocalStorage: ReturnType<typeof makeLocalStorageMock>;

beforeEach(() => {
  vi.restoreAllMocks();
  mockLocalStorage = makeLocalStorageMock();
  vi.stubGlobal("localStorage", mockLocalStorage);
  mockUseLabels.mockReturnValue({ labels: [], loading: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// FilterBar — mode switching
// ---------------------------------------------------------------------------

describe("FilterBar — mode switching", () => {
  it("renders in form mode by default", () => {
    const onChange = vi.fn();
    const { getByText, queryByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    const formButton = getByText("Form");
    const cqlButton = getByText("CQL");
    expect(formButton.getAttribute("aria-pressed")).toBe("true");
    expect(cqlButton.getAttribute("aria-pressed")).toBe("false");
    expect(queryByTestId("cql-input")).toBeNull();
  });

  it("switches to CQL mode when CQL button is clicked", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId, queryByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    expect(getByTestId("cql-input")).toBeTruthy();
    // Form-only controls should be absent
    expect(queryByTestId("filter-label")).toBeNull();
    expect(queryByTestId("filter-priority")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("switches back to form mode when Form button is clicked in CQL mode", () => {
    const onChange = vi.fn();
    const { getByText, queryByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    fireEvent.click(getByText("Form"));
    expect(queryByTestId("cql-input")).toBeNull();
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("CQL button has aria-pressed=false in form mode and true in CQL mode", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    const cqlButton = getByText("CQL");
    expect(cqlButton.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cqlButton);
    expect(cqlButton.getAttribute("aria-pressed")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// FilterBar — localStorage persistence
// ---------------------------------------------------------------------------

describe("FilterBar — localStorage persistence", () => {
  it("reads stored 'cql' mode from localStorage on mount", () => {
    mockLocalStorage.setItem("cadence_filter_mode", "cql");
    const onChange = vi.fn();
    const { getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    expect(getByTestId("cql-input")).toBeTruthy();
  });

  it("falls back to form mode for an unrecognized localStorage value", () => {
    mockLocalStorage.setItem("cadence_filter_mode", "unknown_value");
    const onChange = vi.fn();
    const { queryByTestId, getByText } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    expect(queryByTestId("cql-input")).toBeNull();
    expect(getByText("Form").getAttribute("aria-pressed")).toBe("true");
  });

  it("writes 'cql' to localStorage when switching to CQL mode", () => {
    const onChange = vi.fn();
    const setItemSpy = vi.spyOn(mockLocalStorage, "setItem");
    const { getByText } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    expect(setItemSpy).toHaveBeenCalledWith("cadence_filter_mode", "cql");
  });

  it("writes 'form' to localStorage when switching back to form mode", () => {
    const onChange = vi.fn();
    const setItemSpy = vi.spyOn(mockLocalStorage, "setItem");
    const { getByText } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    fireEvent.click(getByText("Form"));
    expect(setItemSpy).toHaveBeenCalledWith("cadence_filter_mode", "form");
  });
});

// ---------------------------------------------------------------------------
// FilterBar — CQL input: valid queries
// ---------------------------------------------------------------------------

describe("FilterBar — CQL input: valid queries", () => {
  it("calls onChange with parsed filters for valid label query", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "label:bug" } });
    expect(onChange).toHaveBeenCalledWith({ labelName: "bug" });
  });

  it("calls onChange with parsed filters for blocked query", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "blocked" } });
    expect(onChange).toHaveBeenCalledWith({ isBlocked: true });
  });

  it("calls onChange with {} for empty input", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    // Type something first so there is a state change to clear
    fireEvent.change(getByTestId("cql-input"), { target: { value: "label:bug" } });
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("calls onChange with {} for whitespace input", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "   " } });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("calls onChange with excludeLabelName for negated label query", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "-label:bug" } });
    expect(onChange).toHaveBeenCalledWith({ excludeLabelName: "bug" });
  });

  it("calls onChange with excludePriority for negated priority query", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "-priority:HIGH" } });
    expect(onChange).toHaveBeenCalledWith({ excludePriority: "HIGH" });
  });

  it("does not show cql-errors for valid input", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId, queryByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    fireEvent.change(getByTestId("cql-input"), { target: { value: "label:bug" } });
    expect(queryByTestId("cql-errors")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FilterBar — CQL input: invalid queries
// ---------------------------------------------------------------------------

describe("FilterBar — CQL input: invalid queries", () => {
  it("shows inline errors for unknown token", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    fireEvent.change(getByTestId("cql-input"), { target: { value: "badtoken" } });
    expect(getByTestId("cql-errors")).toBeTruthy();
  });

  it("calls onChange with {} for invalid input", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    onChange.mockClear();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "badtoken" } });
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("clears errors when input is cleared", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId, queryByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    fireEvent.click(getByText("CQL"));
    fireEvent.change(getByTestId("cql-input"), { target: { value: "badtoken" } });
    expect(getByTestId("cql-errors")).toBeTruthy();
    fireEvent.change(getByTestId("cql-input"), { target: { value: "" } });
    expect(queryByTestId("cql-errors")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FilterBar — returning to form mode resets filters
// ---------------------------------------------------------------------------

describe("FilterBar — returning to form mode resets filters", () => {
  it("calls onChange({}) when switching from CQL back to form mode", () => {
    const onChange = vi.fn();
    const { getByText, getByTestId } = render(
      <FilterBar filters={{}} onChange={onChange} />,
    );
    // Switch to CQL mode
    fireEvent.click(getByText("CQL"));
    // Type a valid query — onChange should be called with filters
    fireEvent.change(getByTestId("cql-input"), { target: { value: "label:bug" } });
    expect(onChange).toHaveBeenCalledWith({ labelName: "bug" });
    // Switch back to form mode
    fireEvent.click(getByText("Form"));
    // Last onChange call should be with {}
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1][0]).toEqual({});
  });
});

import { describe, it, expect } from "vitest";
import { parseCQL } from "./parseCQL";

describe("parseCQL — empty input", () => {
  it("returns empty filters and no errors for an empty string", () => {
    const { filters, errors } = parseCQL("");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(0);
  });

  it("returns empty filters and no errors for whitespace-only input", () => {
    const { filters, errors } = parseCQL("   ");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(0);
  });
});

describe("parseCQL — label", () => {
  it("parses label:bug", () => {
    const { filters, errors } = parseCQL("label:bug");
    expect(filters).toEqual({ labelName: "bug" });
    expect(errors).toHaveLength(0);
  });

  it("parses -label:bug", () => {
    const { filters, errors } = parseCQL("-label:bug");
    expect(filters).toEqual({ excludeLabelName: "bug" });
    expect(errors).toHaveLength(0);
  });

  it("parses -label:agent-discovered (hyphen in label name)", () => {
    const { filters, errors } = parseCQL("-label:agent-discovered");
    expect(filters).toEqual({ excludeLabelName: "agent-discovered" });
    expect(errors).toHaveLength(0);
  });
});

describe("parseCQL — blocked", () => {
  it("parses blocked → isBlocked: true", () => {
    const { filters, errors } = parseCQL("blocked");
    expect(filters).toEqual({ isBlocked: true });
    expect(errors).toHaveLength(0);
  });

  it("parses -blocked → isBlocked: false", () => {
    const { filters, errors } = parseCQL("-blocked");
    expect(filters).toEqual({ isBlocked: false });
    expect(errors).toHaveLength(0);
  });
});

describe("parseCQL — priority", () => {
  it("parses priority:HIGH", () => {
    const { filters, errors } = parseCQL("priority:HIGH");
    expect(filters).toEqual({ priority: "HIGH" });
    expect(errors).toHaveLength(0);
  });

  it("parses priority:medium (lowercase) case-insensitively", () => {
    const { filters, errors } = parseCQL("priority:medium");
    expect(filters).toEqual({ priority: "MEDIUM" });
    expect(errors).toHaveLength(0);
  });

  it("parses -priority:LOW", () => {
    const { filters, errors } = parseCQL("-priority:LOW");
    expect(filters).toEqual({ excludePriority: "LOW" });
    expect(errors).toHaveLength(0);
  });
});

describe("parseCQL — combined tokens", () => {
  it("parses label:bug blocked", () => {
    const { filters, errors } = parseCQL("label:bug blocked");
    expect(filters).toEqual({ labelName: "bug", isBlocked: true });
    expect(errors).toHaveLength(0);
  });

  it("parses label:enhancement -blocked priority:MEDIUM", () => {
    const { filters, errors } = parseCQL("label:enhancement -blocked priority:MEDIUM");
    expect(filters).toEqual({ labelName: "enhancement", isBlocked: false, priority: "MEDIUM" });
    expect(errors).toHaveLength(0);
  });
});

describe("parseCQL — errors", () => {
  it("produces an error containing the unknown token for 'foo'", () => {
    const { filters, errors } = parseCQL("foo");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("foo");
  });

  it("produces an error for an invalid priority value", () => {
    const { filters, errors } = parseCQL("priority:INVALID");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(1);
  });

  it("produces a conflict error for 'blocked -blocked'", () => {
    const { filters, errors } = parseCQL("blocked -blocked");
    expect(errors).toHaveLength(1);
    expect(errors[0].toLowerCase()).toContain("conflict");
  });

  it("produces a conflict error for 'label:bug -label:bug' and returns empty filters", () => {
    const { filters, errors } = parseCQL("label:bug -label:bug");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0].toLowerCase()).toContain("conflict");
  });

  it("produces a conflict error for 'priority:HIGH -priority:HIGH' and returns empty filters", () => {
    const { filters, errors } = parseCQL("priority:HIGH -priority:HIGH");
    expect(filters).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0].toLowerCase()).toContain("conflict");
  });
});

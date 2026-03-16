import { describe, it, expect } from "vitest";
import stripAnsi from "strip-ansi";
import { formatTicketTable, type TicketNode } from "./ticket.js";

const ticket: TicketNode = {
  id: "abc123",
  number: 1,
  title: "Fix login bug",
  state: "OPEN",
  priority: "HIGH",
  storyPoints: 3,
  assignee: { login: "alice" },
  project: { name: "my-project" },
  labels: [],
};

describe("formatTicketTable", () => {
  it("includes column headers above data rows", () => {
    const output = formatTicketTable([ticket]);
    const lines = output.split("\n");
    const headerLine = stripAnsi(lines[0]);
    expect(headerLine).toMatch(/^  #\s+State\s+Priority\s+Title\s+Points\s+Assignee/);
  });

  it("includes a separator line between header and data", () => {
    const output = formatTicketTable([ticket]);
    const lines = output.split("\n");
    const separatorLine = stripAnsi(lines[1]);
    expect(separatorLine).toMatch(/^\s+─+$/);
  });

  it("renders data rows after the separator", () => {
    const output = formatTicketTable([ticket]);
    const lines = output.split("\n");
    const dataLine = stripAnsi(lines[2]);
    expect(dataLine).toContain("#1");
    expect(dataLine).toContain("Fix login bug");
    expect(dataLine).toContain("OPEN");
    expect(dataLine).toContain("HIGH");
    expect(dataLine).toContain("3pts");
    expect(dataLine).toContain("@alice");
  });

  it("shows Project column when showProject is true", () => {
    const output = formatTicketTable([ticket], { showProject: true });
    const headerLine = stripAnsi(output.split("\n")[0]);
    expect(headerLine).toContain("Project");
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).toContain("my-project");
  });

  it("omits Project column when showProject is false", () => {
    const output = formatTicketTable([ticket], { showProject: false });
    const headerLine = stripAnsi(output.split("\n")[0]);
    expect(headerLine).not.toContain("Project");
  });

  it("suppresses header when showHeader is false", () => {
    const output = formatTicketTable([ticket], { showHeader: false });
    const lines = output.split("\n");
    const firstLine = stripAnsi(lines[0]);
    // First line should be data, not header
    expect(firstLine).toContain("#1");
    expect(firstLine).not.toMatch(/^\s+#\s+State/);
  });

  it("shows BLOCKED in red when ticket has non-CLOSED blockers", () => {
    const blockedTicket: TicketNode = {
      ...ticket,
      blockedBy: [{ id: "blocker1", state: "IN_PROGRESS" }],
    };
    const output = formatTicketTable([blockedTicket]);
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).toContain("BLOCKED");
    expect(dataLine).not.toContain("[OPEN]");
  });

  it("does not show BLOCKED when ticket has no blockers", () => {
    const output = formatTicketTable([ticket]);
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).not.toContain("BLOCKED");
    expect(dataLine).toContain("[OPEN]");
  });

  it("does not show BLOCKED when blockedBy is empty array", () => {
    const unblockedTicket: TicketNode = {
      ...ticket,
      blockedBy: [],
    };
    const output = formatTicketTable([unblockedTicket]);
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).not.toContain("BLOCKED");
    expect(dataLine).toContain("[OPEN]");
  });

  it("does not show BLOCKED when all blockers are CLOSED", () => {
    const closedBlockerTicket: TicketNode = {
      ...ticket,
      blockedBy: [{ id: "blocker1", state: "CLOSED" }],
    };
    const output = formatTicketTable([closedBlockerTicket]);
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).not.toContain("BLOCKED");
    expect(dataLine).toContain("[OPEN]");
  });

  it("shows BLOCKED when at least one blocker is not CLOSED", () => {
    const mixedBlockerTicket: TicketNode = {
      ...ticket,
      blockedBy: [
        { id: "blocker1", state: "CLOSED" },
        { id: "blocker2", state: "IN_PROGRESS" },
      ],
    };
    const output = formatTicketTable([mixedBlockerTicket]);
    const dataLine = stripAnsi(output.split("\n")[2]);
    expect(dataLine).toContain("BLOCKED");
    expect(dataLine).not.toContain("[OPEN]");
  });

  it("aligns header and data columns", () => {
    const output = formatTicketTable([ticket]);
    const lines = output.split("\n");
    const header = stripAnsi(lines[0]);
    const data = stripAnsi(lines[2]);
    // The Priority column should start at the same position in header and data
    const headerPriorityIdx = header.indexOf("Priority");
    const dataPriorityIdx = data.indexOf("HIGH");
    expect(headerPriorityIdx).toBe(dataPriorityIdx);
  });
});

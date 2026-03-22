import type { TicketState } from "../types";

interface LaunchConfig {
  buttonLabel: string;
  command: (ticketNumber: number, ticketTitle: string) => string;
  sessionName: (ticketNumber: number) => string;
}

export function getLaunchConfig(state: TicketState): LaunchConfig {
  switch (state) {
    case "BACKLOG":
      return {
        buttonLabel: "Refine",
        command: (n) => `/refine ${n}`,
        sessionName: (n) => `refine-${n}`,
      };
    case "REFINED":
      return {
        buttonLabel: "Lead",
        command: (n) => `/lead ${n}`,
        sessionName: (n) => `lead-${n}`,
      };
    case "IN_PROGRESS":
      return {
        buttonLabel: "Lead",
        command: (n) => `/lead ${n}`,
        sessionName: (n) => `lead-${n}`,
      };
    case "CLOSED":
      return {
        buttonLabel: "Discuss",
        // Note: ticket titles are user-controlled; see docs/discuss-action-security.md
        command: (n, title) => `Let's discuss ticket #${n} — ${title}`,
        sessionName: (n) => `discuss-${n}`,
      };
    default: {
      const _: never = state;
      throw new Error(`Unhandled TicketState: ${_}`);
    }
  }
}

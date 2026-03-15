import type { PrismaClient } from "@prisma/client";
import { ALLOWED_TRANSITIONS } from "./transitions.js";

export function validateTransition(
  from: string,
  to: string,
): { valid: boolean; error?: string } {
  if (from === to) {
    return { valid: false, error: `Already in state ${from}` };
  }

  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) {
    return { valid: false, error: `Unknown state: ${from}` };
  }

  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `Cannot transition from ${from} to ${to}. Allowed transitions: ${allowed.join(", ")}`,
    };
  }

  return { valid: true };
}

export async function checkBlockerGuard(
  ticketId: string,
  prisma: PrismaClient,
): Promise<{ allowed: boolean; error?: string }> {
  const unresolvedCount = await prisma.blockRelation.count({
    where: {
      blockedId: ticketId,
      blocker: { state: { not: "CLOSED" } },
    },
  });

  if (unresolvedCount > 0) {
    return {
      allowed: false,
      error: `Ticket has ${unresolvedCount} unresolved blocker(s)`,
    };
  }

  return { allowed: true };
}

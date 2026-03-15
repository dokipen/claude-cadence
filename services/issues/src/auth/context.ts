import type { PrismaClient, User } from "@prisma/client";
import { verifyToken } from "./jwt.js";

export interface AuthContext {
  currentUser: User | null;
  accessToken?: string;
}

/**
 * Extract and verify JWT from the Authorization header.
 * Checks the token against the revocation blocklist before accepting.
 * Returns the authenticated user or null if no valid token is present.
 */
export async function buildAuthContext(
  req: { headers: { authorization?: string } },
  prisma: PrismaClient
): Promise<AuthContext> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return { currentUser: null };
  }

  const token = authHeader.slice(7);

  try {
    const { userId, jti } = verifyToken(token);

    // Check if the token has been revoked
    const revoked = await prisma.revokedToken.findUnique({
      where: { jti },
    });
    if (revoked) {
      return { currentUser: null };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    return { currentUser: user, accessToken: token };
  } catch {
    return { currentUser: null };
  }
}

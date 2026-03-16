import type { PrismaClient } from "@prisma/client";

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function cleanupExpiredTokens(prisma: PrismaClient) {
  const now = new Date();

  const [refreshResult, revokedResult] = await Promise.all([
    prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.revokedToken.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
  ]);

  const total = refreshResult.count + revokedResult.count;
  if (total > 0) {
    console.log(
      `Token cleanup: deleted ${refreshResult.count} expired refresh tokens, ${revokedResult.count} expired revoked tokens`
    );
  }
}

export function startCleanupSchedule(prisma: PrismaClient): NodeJS.Timeout {
  function scheduleNext(): NodeJS.Timeout {
    return setTimeout(async () => {
      try {
        await cleanupExpiredTokens(prisma);
      } catch (err) {
        console.error("Token cleanup failed:", err);
      }
      timer = scheduleNext();
    }, CLEANUP_INTERVAL_MS);
  }

  let timer: NodeJS.Timeout;

  cleanupExpiredTokens(prisma).catch((err) => {
    console.error("Token cleanup failed:", err);
  });

  timer = scheduleNext();
  return timer;
}

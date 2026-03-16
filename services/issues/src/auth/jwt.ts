import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { isProduction } from "../env.js";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (isProduction) {
      throw new Error("JWT_SECRET environment variable is required");
    }
    const generated = randomBytes(32).toString("hex");
    console.warn("JWT_SECRET not set — using random secret (sessions won't survive restarts)");
    return generated;
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();
export const ACCESS_TOKEN_EXPIRY = "15m";
export const ACCESS_TOKEN_EXPIRY_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_EXPIRY_DAYS = 30;

export interface JwtPayload {
  userId: string;
  jti: string;
}

export function signToken(userId: string): string {
  const jti = randomBytes(16).toString("hex");
  return jwt.sign({ userId, jti } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}

export function verifyToken(token: string): JwtPayload {
  const payload = jwt.verify(token, JWT_SECRET);
  if (typeof payload === "string" || !("userId" in payload)) {
    throw new Error("Invalid token payload");
  }
  return {
    userId: (payload as JwtPayload).userId,
    jti: (payload as JwtPayload).jti,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

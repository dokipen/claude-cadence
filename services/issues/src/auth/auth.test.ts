import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

// Set JWT_SECRET before importing jwt module
process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { signToken, verifyToken, generateRefreshToken, ACCESS_TOKEN_EXPIRY } =
  await import("./jwt.js");

describe("JWT", () => {
  it("should sign and verify a token", () => {
    const token = signToken("user-123");
    const payload = verifyToken(token);
    expect(payload.userId).toBe("user-123");
  });

  it("should include a jti in signed tokens", () => {
    const token = signToken("user-123");
    const payload = verifyToken(token);
    expect(payload.jti).toBeDefined();
    expect(payload.jti).toHaveLength(32); // 16 bytes hex-encoded
  });

  it("should generate unique jti for each token", () => {
    const token1 = signToken("user-123");
    const token2 = signToken("user-123");
    const payload1 = verifyToken(token1);
    const payload2 = verifyToken(token2);
    expect(payload1.jti).not.toBe(payload2.jti);
  });

  it("should include expiry in signed tokens", () => {
    const token = signToken("user-123");
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();

    // Token should expire in ~15 minutes
    const expiresIn = decoded.exp - decoded.iat;
    expect(expiresIn).toBe(15 * 60);
  });

  it("should reject an invalid token", () => {
    expect(() => verifyToken("invalid-token")).toThrow();
  });

  it("should reject an expired token", () => {
    const token = jwt.sign(
      { userId: "user-123", jti: "test-jti" },
      process.env.JWT_SECRET!,
      { expiresIn: "-1s" }
    );
    expect(() => verifyToken(token)).toThrow();
  });

  it("should reject a token signed with a different secret", () => {
    const token = jwt.sign(
      { userId: "user-123", jti: "test-jti" },
      "wrong-secret",
      { expiresIn: "1h" }
    );
    expect(() => verifyToken(token)).toThrow();
  });

  it("should export access token expiry as 15 minutes", () => {
    expect(ACCESS_TOKEN_EXPIRY).toBe("15m");
  });
});

describe("generateRefreshToken", () => {
  it("should generate a 64-character hex string", () => {
    const token = generateRefreshToken();
    expect(token).toHaveLength(64); // 32 bytes hex-encoded
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("should generate unique tokens", () => {
    const token1 = generateRefreshToken();
    const token2 = generateRefreshToken();
    expect(token1).not.toBe(token2);
  });
});

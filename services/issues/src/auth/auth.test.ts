import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";

// Set JWT_SECRET before importing jwt module
process.env.JWT_SECRET = "test-secret-for-unit-tests";

const { signToken, verifyToken } = await import("./jwt.js");

describe("JWT", () => {
  it("should sign and verify a token", () => {
    const token = signToken("user-123");
    const payload = verifyToken(token);
    expect(payload.userId).toBe("user-123");
  });

  it("should include expiry in signed tokens", () => {
    const token = signToken("user-123");
    const decoded = jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp).toBeDefined();
    expect(decoded.iat).toBeDefined();

    // Token should expire in ~7 days
    const expiresIn = decoded.exp - decoded.iat;
    expect(expiresIn).toBe(7 * 24 * 60 * 60);
  });

  it("should reject an invalid token", () => {
    expect(() => verifyToken("invalid-token")).toThrow();
  });

  it("should reject an expired token", () => {
    const token = jwt.sign(
      { userId: "user-123" },
      process.env.JWT_SECRET!,
      { expiresIn: "-1s" }
    );
    expect(() => verifyToken(token)).toThrow();
  });

  it("should reject a token signed with a different secret", () => {
    const token = jwt.sign({ userId: "user-123" }, "wrong-secret", { expiresIn: "1h" });
    expect(() => verifyToken(token)).toThrow();
  });
});

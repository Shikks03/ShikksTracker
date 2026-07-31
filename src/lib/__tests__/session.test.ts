/**
 * Unit tests for src/lib/session.ts.
 *
 * Covers: v2 token round-trip, rejection of the old 2-part format (the
 * regression guard for the "HMAC keyed by the raw password" vulnerability),
 * tamper detection (MAC + expiry), expiry, cross-secret rejection,
 * malformed-input shapes, and assertSessionSecret's fail-closed behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  assertSessionSecret,
} from "@/lib/session";

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

describe("createSessionToken / verifySessionToken", () => {
  it("round-trips: a token created with secret S verifies true with S", async () => {
    const token = await createSessionToken(SECRET_A);
    expect(await verifySessionToken(token, SECRET_A)).toBe(true);
  });

  it("produces the v2.<jti>.<issuedAt>.<expiresAt>.<hmac> shape", async () => {
    const token = await createSessionToken(SECRET_A);
    const parts = token.split(".");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v2");
    expect(parts[1].length).toBeGreaterThan(0); // jti (uuid)
    expect(Number.isFinite(parseInt(parts[2], 10))).toBe(true); // issuedAt
    expect(Number.isFinite(parseInt(parts[3], 10))).toBe(true); // expiresAt
    expect(parts[4]).toMatch(/^[0-9a-f]{64}$/); // hex-encoded SHA-256 HMAC
  });

  it("rejects the old 2-part format '<expiresAtMs>.<hex-hmac>' outright", async () => {
    // Regression guard: the old format signed only the expiry, keyed by the
    // raw password. There must be no fallback path that accepts it.
    const farFuture = Date.now() + 1000 * 60 * 60 * 24 * 30;
    const oldStyleToken = `${farFuture}.${"a".repeat(64)}`;
    expect(await verifySessionToken(oldStyleToken, SECRET_A)).toBe(false);
  });

  it("rejects a token with a tampered HMAC", async () => {
    const token = await createSessionToken(SECRET_A);
    const parts = token.split(".");
    const tamperedHex =
      parts[4].slice(0, -1) + (parts[4].slice(-1) === "0" ? "1" : "0");
    const tampered = [...parts.slice(0, 4), tamperedHex].join(".");
    expect(await verifySessionToken(tampered, SECRET_A)).toBe(false);
  });

  it("rejects a token with a tampered expiry (prefix changed, MAC stale)", async () => {
    const token = await createSessionToken(SECRET_A);
    const parts = token.split(".");
    const bumpedExpiry = String(parseInt(parts[3], 10) + 1000 * 60 * 60 * 24 * 365);
    const tampered = [parts[0], parts[1], parts[2], bumpedExpiry, parts[4]].join(".");
    expect(await verifySessionToken(tampered, SECRET_A)).toBe(false);
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00Z"));
      const token = await createSessionToken(SECRET_A);

      vi.setSystemTime(new Date("2020-01-15T00:00:00Z")); // 14 days later, well past 7-day max age
      expect(await verifySessionToken(token, SECRET_A)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken(SECRET_A);
    expect(await verifySessionToken(token, SECRET_B)).toBe(false);
  });

  describe("malformed inputs", () => {
    it.each([
      ["empty string", ""],
      ["no dots", "notatoken"],
      ["two dots", "a.b.c"],
      ["six dots", "v2.a.b.c.d.e"],
      ["v1 prefix with otherwise-valid shape", `v1.${"x".repeat(8)}.${Date.now()}.${Date.now() + 1000}.${"a".repeat(64)}`],
    ])("returns false for %s", async (_label, input) => {
      expect(await verifySessionToken(input, SECRET_A)).toBe(false);
    });
  });
});

describe("assertSessionSecret", () => {
  const ORIGINAL = process.env.SESSION_SECRET;

  beforeEach(() => {
    delete process.env.SESSION_SECRET;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = ORIGINAL;
    }
  });

  it("throws when SESSION_SECRET is unset", () => {
    expect(() => assertSessionSecret()).toThrow();
  });

  it("throws when SESSION_SECRET is shorter than 32 chars", () => {
    process.env.SESSION_SECRET = "short-secret";
    expect(() => assertSessionSecret()).toThrow();
  });

  it("returns the secret when it is set and >= 32 chars", () => {
    process.env.SESSION_SECRET = "c".repeat(32);
    expect(assertSessionSecret()).toBe("c".repeat(32));
  });
});

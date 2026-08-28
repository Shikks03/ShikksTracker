/**
 * Unit tests for the /api/os/* secret guard (spec §D.1).
 *
 * checkOsSecret is the pure half of requireOsSecret precisely so the rule can be
 * asserted without constructing a NextRequest — same split as
 * checkMarkSentAllowed / the mark-sent route.
 */

import { describe, it, expect } from "vitest";
import { checkOsSecret, OS_API_SECRET_MIN_LENGTH } from "@/lib/auth";

const GOOD = "s".repeat(OS_API_SECRET_MIN_LENGTH);

describe("checkOsSecret", () => {
  it("fails closed with 503 when the secret is not configured", () => {
    const result = checkOsSecret(GOOD, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
  });

  it("fails closed with 503 when the secret is shorter than the minimum", () => {
    const short = "s".repeat(OS_API_SECRET_MIN_LENGTH - 1);
    // Even a *matching* header must not authorize a too-weak secret.
    const result = checkOsSecret(short, short);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(503);
  });

  it("401s a missing header", () => {
    const result = checkOsSecret(null, GOOD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(401);
  });

  it("401s a wrong header of the same length", () => {
    const result = checkOsSecret("x".repeat(OS_API_SECRET_MIN_LENGTH), GOOD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(401);
  });

  it("401s a header that is a correct prefix of the secret", () => {
    const result = checkOsSecret(GOOD.slice(0, 8), GOOD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.httpStatus).toBe(401);
  });

  it("does not throw on a length mismatch (both sides are hashed first)", () => {
    // timingSafeEqual throws on unequal buffer lengths; hashing both sides is
    // what makes a short header a plain 401 instead of a 500.
    expect(() => checkOsSecret("a", GOOD)).not.toThrow();
  });

  it("accepts the exact secret", () => {
    expect(checkOsSecret(GOOD, GOOD)).toEqual({ ok: true });
  });

  it("requires at least 32 characters", () => {
    expect(OS_API_SECRET_MIN_LENGTH).toBe(32);
  });
});

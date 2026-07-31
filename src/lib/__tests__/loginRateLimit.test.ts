/**
 * Unit tests for the pure decision function in src/lib/loginRateLimit.ts.
 *
 * checkLoginRateLimit/recordLoginFailure/clearLoginFailures are Mongo-backed
 * and intentionally not covered here (no DB in this test run) — isLockedOut
 * is the pure core they all funnel through, and it's what actually decides
 * whether a request gets a 429.
 */

import { describe, it, expect } from "vitest";
import { isLockedOut } from "@/lib/loginRateLimit";

describe("isLockedOut", () => {
  const MAX_PER_IP = 5;
  const MAX_GLOBAL = 20;

  it("is not locked when both counts are below their thresholds", () => {
    expect(isLockedOut(4, 19, MAX_PER_IP, MAX_GLOBAL)).toBe(false);
  });

  it("is not locked at zero failures", () => {
    expect(isLockedOut(0, 0, MAX_PER_IP, MAX_GLOBAL)).toBe(false);
  });

  it("is locked when per-IP count exactly equals the per-IP max (inclusive boundary)", () => {
    expect(isLockedOut(MAX_PER_IP, 0, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("is locked when per-IP count exceeds the per-IP max", () => {
    expect(isLockedOut(MAX_PER_IP + 1, 0, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("is locked when global count exactly equals the global max (inclusive boundary)", () => {
    expect(isLockedOut(0, MAX_GLOBAL, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("is locked when global count exceeds the global max", () => {
    expect(isLockedOut(0, MAX_GLOBAL + 1, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("is locked when both counts are over their thresholds", () => {
    expect(isLockedOut(MAX_PER_IP + 2, MAX_GLOBAL + 2, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("per-IP lockout applies even when the global count is well below its max", () => {
    expect(isLockedOut(MAX_PER_IP, 1, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("global lockout applies even when the per-IP count is well below its max", () => {
    expect(isLockedOut(1, MAX_GLOBAL, MAX_PER_IP, MAX_GLOBAL)).toBe(true);
  });

  it("one below both thresholds is not locked", () => {
    expect(isLockedOut(MAX_PER_IP - 1, MAX_GLOBAL - 1, MAX_PER_IP, MAX_GLOBAL)).toBe(false);
  });
});

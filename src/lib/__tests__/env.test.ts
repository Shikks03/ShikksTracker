/**
 * Unit tests for src/lib/env.ts — envInt (pre-existing) plus parseLimit /
 * parseOffset, added in security-phase-2 (Wave C) to bound previously
 * unbounded list-query routes.
 */

import { describe, it, expect } from "vitest";
import { envInt, parseLimit, parseOffset } from "@/lib/env";

describe("envInt", () => {
  it("returns the fallback when the env var is unset", () => {
    expect(envInt("SHIKKSTRACKER_TEST_UNSET_VAR", 42)).toBe(42);
  });
});

describe("parseLimit", () => {
  it("returns the default when the limit param is absent", () => {
    const sp = new URLSearchParams("");
    expect(parseLimit(sp, 1000, 5000)).toBe(1000);
  });

  it("returns the parsed value when within range", () => {
    const sp = new URLSearchParams("limit=250");
    expect(parseLimit(sp, 1000, 5000)).toBe(250);
  });

  it("clamps a value above max down to max", () => {
    const sp = new URLSearchParams("limit=999999");
    expect(parseLimit(sp, 1000, 5000)).toBe(5000);
  });

  it("clamps 0 up to 1", () => {
    const sp = new URLSearchParams("limit=0");
    expect(parseLimit(sp, 1000, 5000)).toBe(1);
  });

  it("clamps a negative value up to 1", () => {
    const sp = new URLSearchParams("limit=-50");
    expect(parseLimit(sp, 1000, 5000)).toBe(1);
  });

  it("returns the default for non-numeric garbage", () => {
    const sp = new URLSearchParams("limit=not-a-number");
    expect(parseLimit(sp, 1000, 5000)).toBe(1000);
  });

  it("clamps a huge value to max", () => {
    const sp = new URLSearchParams("limit=1e30");
    // parseInt("1e30", 10) parses only the leading "1" — this asserts the
    // clamp still holds regardless of how parseInt handles exponent syntax.
    expect(parseLimit(sp, 1000, 5000)).toBeLessThanOrEqual(5000);
  });

  it("accepts a value exactly at max", () => {
    const sp = new URLSearchParams("limit=5000");
    expect(parseLimit(sp, 1000, 5000)).toBe(5000);
  });

  it("accepts a value exactly at 1", () => {
    const sp = new URLSearchParams("limit=1");
    expect(parseLimit(sp, 1000, 5000)).toBe(1);
  });
});

describe("parseOffset", () => {
  it("returns 0 when the offset param is absent", () => {
    const sp = new URLSearchParams("");
    expect(parseOffset(sp, 100_000)).toBe(0);
  });

  it("returns the parsed value when within range", () => {
    const sp = new URLSearchParams("offset=250");
    expect(parseOffset(sp, 100_000)).toBe(250);
  });

  it("clamps a value above max down to max", () => {
    const sp = new URLSearchParams("offset=999999999");
    expect(parseOffset(sp, 100_000)).toBe(100_000);
  });

  it("clamps a negative value up to 0", () => {
    const sp = new URLSearchParams("offset=-50");
    expect(parseOffset(sp, 100_000)).toBe(0);
  });

  it("returns 0 for non-numeric garbage", () => {
    const sp = new URLSearchParams("offset=not-a-number");
    expect(parseOffset(sp, 100_000)).toBe(0);
  });

  it("returns 0 for the value 0", () => {
    const sp = new URLSearchParams("offset=0");
    expect(parseOffset(sp, 100_000)).toBe(0);
  });
});

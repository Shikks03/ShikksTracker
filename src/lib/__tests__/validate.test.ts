/**
 * Unit tests for src/lib/validate.ts — the hand-rolled request-input guards
 * added in security-phase-2.
 *
 * asObjectIdString is the core NoSQL-injection guard: any downstream Mongo
 * filter built from unvalidated request input (e.g. `{ campaignId: v }`)
 * must never receive anything other than a plain, valid ObjectId string —
 * otherwise an object like `{ "$ne": null }` becomes a live operator
 * expression instead of an equality match.
 */

import { describe, it, expect } from "vitest";
import {
  asObjectIdString,
  asString,
  asOptionalString,
  validateSequenceSpacingDays,
} from "@/lib/validate";

describe("asObjectIdString", () => {
  const VALID_ID = "507f1f77bcf86cd799439011";

  it("accepts a real 24-hex ObjectId string", () => {
    expect(asObjectIdString(VALID_ID)).toBe(VALID_ID);
  });

  it("rejects a NoSQL operator-injection object ({ $ne: null })", () => {
    expect(asObjectIdString({ $ne: null })).toBeNull();
  });

  it("rejects a different operator-injection object ({ $gt: '' })", () => {
    expect(asObjectIdString({ $gt: "" })).toBeNull();
  });

  it("rejects an array, even one wrapping a valid id", () => {
    expect(asObjectIdString([VALID_ID])).toBeNull();
  });

  it("rejects a number", () => {
    expect(asObjectIdString(123)).toBeNull();
  });

  it("rejects a boolean", () => {
    expect(asObjectIdString(true)).toBeNull();
  });

  it("rejects null", () => {
    expect(asObjectIdString(null)).toBeNull();
  });

  it("rejects undefined", () => {
    expect(asObjectIdString(undefined)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(asObjectIdString("")).toBeNull();
  });

  it("rejects a malformed / non-hex string", () => {
    expect(asObjectIdString("not-an-objectid")).toBeNull();
  });
});

describe("asString", () => {
  it("returns the trimmed string for valid input", () => {
    expect(asString("  hello  ", 20)).toBe("hello");
  });

  it("rejects non-string input", () => {
    expect(asString(123, 20)).toBeNull();
    expect(asString(null, 20)).toBeNull();
    expect(asString(undefined, 20)).toBeNull();
    expect(asString({}, 20)).toBeNull();
    expect(asString(["a"], 20)).toBeNull();
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(asString("", 20)).toBeNull();
    expect(asString("   ", 20)).toBeNull();
  });

  it("accepts a string exactly at the maxLen boundary", () => {
    const s = "a".repeat(10);
    expect(asString(s, 10)).toBe(s);
  });

  it("rejects a string one character over the maxLen boundary", () => {
    const s = "a".repeat(11);
    expect(asString(s, 10)).toBeNull();
  });

  it("measures maxLen against the trimmed length, not the raw length", () => {
    // Raw length 12 ("  aaaaaaaa  "), trimmed length 8 — should pass a
    // maxLen of 8 because trimming happens before the length check.
    expect(asString("  aaaaaaaa  ", 8)).toBe("aaaaaaaa");
  });
});

describe("asOptionalString", () => {
  it("returns undefined for null", () => {
    expect(asOptionalString(null, 20)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(asOptionalString(undefined, 20)).toBeUndefined();
  });

  it("returns undefined (not null) for an invalid non-null value", () => {
    expect(asOptionalString(123, 20)).toBeUndefined();
    expect(asOptionalString("", 20)).toBeUndefined();
    expect(asOptionalString("a".repeat(21), 20)).toBeUndefined();
  });

  it("returns the trimmed string for valid input", () => {
    expect(asOptionalString("  hi  ", 20)).toBe("hi");
  });
});

describe("validateSequenceSpacingDays", () => {
  it("accepts the default [0, 5, 9]", () => {
    expect(validateSequenceSpacingDays([0, 5, 9])).toEqual([0, 5, 9]);
  });

  it("rejects a non-array", () => {
    expect(validateSequenceSpacingDays("0,5,9")).toBeNull();
    expect(validateSequenceSpacingDays(null)).toBeNull();
    expect(validateSequenceSpacingDays(undefined)).toBeNull();
  });

  it("rejects a NoSQL operator-injection object ({ $ne: null })", () => {
    expect(validateSequenceSpacingDays({ $ne: null })).toBeNull();
  });

  it("rejects an array that is not exactly 3 elements", () => {
    expect(validateSequenceSpacingDays([0, 5])).toBeNull();
    expect(validateSequenceSpacingDays([0, 5, 9, 12])).toBeNull();
  });

  it("rejects an array longer than 10 elements", () => {
    expect(validateSequenceSpacingDays([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBeNull();
  });

  it("rejects negative numbers", () => {
    expect(validateSequenceSpacingDays([0, -5, 9])).toBeNull();
  });

  it("rejects non-integer (fractional) values", () => {
    expect(validateSequenceSpacingDays([0, 5.5, 9])).toBeNull();
  });

  it("rejects values greater than 365", () => {
    expect(validateSequenceSpacingDays([0, 5, 400])).toBeNull();
  });

  it("rejects an array that does not start at 0", () => {
    expect(validateSequenceSpacingDays([1, 5, 9])).toBeNull();
  });

  it("rejects an array that is not strictly increasing", () => {
    expect(validateSequenceSpacingDays([0, 5, 5])).toBeNull();
    expect(validateSequenceSpacingDays([0, 9, 5])).toBeNull();
  });

  it("rejects non-number elements, including nested injection objects", () => {
    expect(validateSequenceSpacingDays([0, { $ne: null }, 9])).toBeNull();
    expect(validateSequenceSpacingDays([0, "5", 9])).toBeNull();
  });
});

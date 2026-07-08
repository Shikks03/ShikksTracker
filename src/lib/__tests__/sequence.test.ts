/**
 * Unit tests for pure helpers in src/lib/sequence.ts.
 *
 * These tests pin CURRENT behavior as a regression baseline before
 * Task 3.7 (window off-by-one + small correctness fixes) changes expectations.
 *
 * Manila = fixed UTC+8, no DST. All times expressed in UTC; Manila civil time
 * is always UTC + 8 hours.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getManilaHour,
  isWithinSendWindow,
  getManilaDayStart,
  computeNextSendAt,
} from "@/lib/sequence";

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// getManilaHour
// ---------------------------------------------------------------------------

describe("getManilaHour", () => {
  it("returns the Manila hour for a UTC date in the morning", () => {
    // 2026-07-04T01:30:00Z → Manila 09:30 → hour 9
    const date = new Date("2026-07-04T01:30:00Z");
    expect(getManilaHour(date)).toBe(9);
  });

  it("returns 0 for Manila midnight (UTC 16:00 previous day)", () => {
    // 2026-07-03T16:00:00Z → Manila 2026-07-04 00:00 → hour 0
    const date = new Date("2026-07-03T16:00:00Z");
    expect(getManilaHour(date)).toBe(0);
  });

  it("returns 8 for Manila 08:00 (UTC 00:00)", () => {
    // 2026-07-04T00:00:00Z → Manila 2026-07-04 08:00 → hour 8
    const date = new Date("2026-07-04T00:00:00Z");
    expect(getManilaHour(date)).toBe(8);
  });

  it("returns 17 for Manila 17:00 (UTC 09:00)", () => {
    // 2026-07-04T09:00:00Z → Manila 2026-07-04 17:00 → hour 17
    const date = new Date("2026-07-04T09:00:00Z");
    expect(getManilaHour(date)).toBe(17);
  });

  it("returns 18 for Manila 18:00 (UTC 10:00)", () => {
    // 2026-07-04T10:00:00Z → Manila 2026-07-04 18:00 → hour 18
    const date = new Date("2026-07-04T10:00:00Z");
    expect(getManilaHour(date)).toBe(18);
  });

  it("returns 23 for Manila 23:00 (UTC 15:00)", () => {
    // 2026-07-04T15:00:00Z → Manila 2026-07-04 23:00 → hour 23
    const date = new Date("2026-07-04T15:00:00Z");
    expect(getManilaHour(date)).toBe(23);
  });
});

// ---------------------------------------------------------------------------
// isWithinSendWindow
// ---------------------------------------------------------------------------

// Send window: [8, 18) Manila — hour >= 8 AND hour < 18.
// Task 3.7 will re-examine the boundary at hour 18 (currently excluded).

describe("isWithinSendWindow", () => {
  it("returns false for Manila hour 7 (just before window)", () => {
    // Manila 07:00 = UTC 2026-07-03T23:00:00Z
    const date = new Date("2026-07-03T23:00:00Z");
    expect(isWithinSendWindow(date)).toBe(false);
  });

  it("returns true for Manila hour 8 (window open boundary)", () => {
    // Manila 08:00 = UTC 2026-07-04T00:00:00Z
    const date = new Date("2026-07-04T00:00:00Z");
    expect(isWithinSendWindow(date)).toBe(true);
  });

  it("returns true for Manila hour 17 (last hour inside window)", () => {
    // Manila 17:00 = UTC 2026-07-04T09:00:00Z
    const date = new Date("2026-07-04T09:00:00Z");
    expect(isWithinSendWindow(date)).toBe(true);
  });

  it("returns false for Manila hour 18 (window closed boundary — CURRENT behavior; Task 3.7 aligns UI to this)", () => {
    // Manila 18:00 = UTC 2026-07-04T10:00:00Z
    // The engine correctly excludes hour 18 (exclusive upper bound).
    // The UI showed "8am-6pm" which implies inclusivity — Task 3.7 reconciles
    // that discrepancy. This test pins the current code behavior.
    const date = new Date("2026-07-04T10:00:00Z");
    expect(isWithinSendWindow(date)).toBe(false);
  });

  it("returns false for Manila midnight (hour 0)", () => {
    const date = new Date("2026-07-03T16:00:00Z"); // Manila midnight
    expect(isWithinSendWindow(date)).toBe(false);
  });

  it("returns true for midday Manila (hour 12)", () => {
    // Manila 12:00 = UTC 04:00
    const date = new Date("2026-07-04T04:00:00Z");
    expect(isWithinSendWindow(date)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getManilaDayStart
// ---------------------------------------------------------------------------

describe("getManilaDayStart", () => {
  it("returns Manila midnight as UTC for a morning Manila time", () => {
    // 2026-07-04T01:30:00Z → Manila 09:30 → Manila midnight = 2026-07-04T00:00 Manila
    // Manila midnight in UTC = 2026-07-03T16:00:00Z
    const date = new Date("2026-07-04T01:30:00Z");
    const result = getManilaDayStart(date);
    expect(result.toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("returns Manila midnight for exactly Manila midnight (UTC 16:00 prev day)", () => {
    // 2026-07-03T16:00:00Z IS Manila midnight 2026-07-04
    const date = new Date("2026-07-03T16:00:00Z");
    const result = getManilaDayStart(date);
    expect(result.toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("returns the previous Manila day start for early UTC times just before Manila midnight", () => {
    // 2026-07-03T15:59:59Z → Manila 2026-07-03T23:59:59 → Manila day start = 2026-07-02T16:00:00Z
    const date = new Date("2026-07-03T15:59:59Z");
    const result = getManilaDayStart(date);
    expect(result.toISOString()).toBe("2026-07-02T16:00:00.000Z");
  });

  it("returns the correct Manila day start at end of Manila business day", () => {
    // Manila 18:00 on 2026-07-04 = UTC 10:00 on 2026-07-04
    // Manila day start = 2026-07-03T16:00:00Z
    const date = new Date("2026-07-04T10:00:00Z");
    const result = getManilaDayStart(date);
    expect(result.toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// computeNextSendAt
// ---------------------------------------------------------------------------

describe("computeNextSendAt", () => {
  const firstSentAt = new Date("2026-07-01T00:00:00Z");
  const spacing = [0, 5, 9]; // default [day0, day5, day9]

  it("computes stage 2 nextSendAt as firstSentAt + spacingDays[1] days", () => {
    // spacingDays[1] = 5 → +5 days from 2026-07-01 = 2026-07-06
    const result = computeNextSendAt(firstSentAt, spacing, 2);
    expect(result.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });

  it("computes stage 3 nextSendAt as firstSentAt + spacingDays[2] days", () => {
    // spacingDays[2] = 9 → +9 days from 2026-07-01 = 2026-07-10
    const result = computeNextSendAt(firstSentAt, spacing, 3);
    expect(result.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("falls back to 5 days for stage 2 when spacing array is too short", () => {
    // If spacingDays[1] is undefined, fallback is 5 (nextStage === 2 ? 5 : 9)
    const result = computeNextSendAt(firstSentAt, [0], 2);
    expect(result.toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });

  it("falls back to 9 days for stage 3 when spacing array is too short", () => {
    // If spacingDays[2] is undefined, fallback is 9
    const result = computeNextSendAt(firstSentAt, [0, 5], 3);
    expect(result.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("falls back to 9 days for stage 3 when spacing array is empty", () => {
    const result = computeNextSendAt(firstSentAt, [], 3);
    expect(result.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("respects custom spacing values", () => {
    // Custom spacing: [0, 7, 14]
    const result = computeNextSendAt(firstSentAt, [0, 7, 14], 3);
    // firstSentAt + 14 days = 2026-07-15
    expect(result.toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });
});

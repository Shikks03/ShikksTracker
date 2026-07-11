/**
 * Unit tests for next-action pure helpers in src/lib/sequence.ts (Task 6.5).
 *
 * Covers:
 *   - isNextActionDue  — the "due" predicate (non-null and <= now)
 *   - daysOverdue      — whole Manila days elapsed since the action date
 *   - shouldSuppressActionDigest — one-per-Manila-day throttle
 *
 * Manila = fixed UTC+8, no DST.
 * Manila midnight on 2026-07-04 = 2026-07-03T16:00:00Z
 */

import { describe, it, expect } from "vitest";
import {
  isNextActionDue,
  daysOverdue,
  shouldSuppressActionDigest,
} from "@/lib/sequence";

// ---------------------------------------------------------------------------
// isNextActionDue
// ---------------------------------------------------------------------------

describe("isNextActionDue", () => {
  const now = new Date("2026-07-10T06:00:00Z"); // Manila 14:00

  it("returns false for null nextActionAt", () => {
    expect(isNextActionDue(null, now)).toBe(false);
  });

  it("returns false for undefined nextActionAt", () => {
    expect(isNextActionDue(undefined, now)).toBe(false);
  });

  it("returns true when nextActionAt is in the past", () => {
    const past = new Date("2026-07-09T06:00:00Z"); // yesterday Manila
    expect(isNextActionDue(past, now)).toBe(true);
  });

  it("returns true when nextActionAt equals now exactly", () => {
    expect(isNextActionDue(now, now)).toBe(true);
  });

  it("returns false when nextActionAt is in the future", () => {
    const future = new Date("2026-07-11T06:00:00Z"); // tomorrow
    expect(isNextActionDue(future, now)).toBe(false);
  });

  it("returns true when nextActionAt is 1 ms before now", () => {
    const justBefore = new Date(now.getTime() - 1);
    expect(isNextActionDue(justBefore, now)).toBe(true);
  });

  it("returns false when nextActionAt is 1 ms after now", () => {
    const justAfter = new Date(now.getTime() + 1);
    expect(isNextActionDue(justAfter, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// daysOverdue
// ---------------------------------------------------------------------------
//
// "Days overdue" is Manila-day–based:
//   - same Manila day  → 0  (not yet overdue)
//   - past Manila day  → positive integer (number of Manila days elapsed)
//
// Manila midnight: 2026-07-03T16:00:00Z = Manila 2026-07-04 00:00
//                  2026-07-04T16:00:00Z = Manila 2026-07-05 00:00
//                  2026-07-09T16:00:00Z = Manila 2026-07-10 00:00

describe("daysOverdue", () => {
  // now = 2026-07-10T06:00:00Z → Manila 2026-07-10 14:00
  const now = new Date("2026-07-10T06:00:00Z");

  it("returns 0 when action is due today (same Manila day)", () => {
    // any time on Manila 2026-07-10 — use Manila 08:00 (UTC 00:00)
    const today = new Date("2026-07-10T00:00:00Z"); // Manila 08:00 Jul 10
    expect(daysOverdue(today, now)).toBe(0);
  });

  it("returns 0 when action is scheduled for the future", () => {
    const future = new Date("2026-07-11T00:00:00Z"); // Manila Jul 11
    expect(daysOverdue(future, now)).toBe(0);
  });

  it("returns 1 when action was due yesterday Manila", () => {
    // Manila 2026-07-09 = UTC range [2026-07-08T16:00Z, 2026-07-09T15:59Z]
    const yesterday = new Date("2026-07-09T00:00:00Z"); // Manila Jul 9 08:00
    expect(daysOverdue(yesterday, now)).toBe(1);
  });

  it("returns 3 when action was due 3 Manila days ago", () => {
    // Manila 2026-07-07 → 3 days before Manila Jul 10
    const threeDaysAgo = new Date("2026-07-07T00:00:00Z"); // Manila Jul 7 08:00
    expect(daysOverdue(threeDaysAgo, now)).toBe(3);
  });

  it("returns correct count when action is exactly at Manila midnight boundary", () => {
    // Manila midnight 2026-07-09 = 2026-07-08T16:00:00Z
    const manilaJul9Midnight = new Date("2026-07-08T16:00:00Z");
    // now is Manila Jul 10 → 1 Manila day after Manila Jul 9
    expect(daysOverdue(manilaJul9Midnight, now)).toBe(1);
  });

  it("returns 0 for a future date that is also past the current UTC time but in the same Manila day", () => {
    // now = Manila Jul 10 14:00. A date earlier today Manila is "today", not overdue.
    const earlierToday = new Date("2026-07-09T16:30:00Z"); // Manila Jul 10 00:30
    expect(daysOverdue(earlierToday, now)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shouldSuppressActionDigest
// ---------------------------------------------------------------------------
//
// Returns true when `lastActionDigestSentAt` falls on the same Manila calendar
// day as `now`, meaning a digest was already sent today.

describe("shouldSuppressActionDigest", () => {
  // now = 2026-07-10T06:00:00Z → Manila 2026-07-10 14:00
  const now = new Date("2026-07-10T06:00:00Z");

  it("returns false when lastActionDigestSentAt is null", () => {
    expect(shouldSuppressActionDigest(null, now)).toBe(false);
  });

  it("returns false when lastActionDigestSentAt is undefined", () => {
    expect(shouldSuppressActionDigest(undefined, now)).toBe(false);
  });

  it("returns true when lastActionDigestSentAt is earlier today (same Manila day)", () => {
    // Manila 2026-07-10 08:00 = UTC 2026-07-10T00:00:00Z
    const earlierToday = new Date("2026-07-10T00:00:00Z");
    expect(shouldSuppressActionDigest(earlierToday, now)).toBe(true);
  });

  it("returns true when lastActionDigestSentAt is exactly Manila midnight today", () => {
    // Manila midnight 2026-07-10 = 2026-07-09T16:00:00Z
    const manilaToday = new Date("2026-07-09T16:00:00Z");
    expect(shouldSuppressActionDigest(manilaToday, now)).toBe(true);
  });

  it("returns false when lastActionDigestSentAt was yesterday Manila", () => {
    // Manila 2026-07-09 12:00 = UTC 2026-07-09T04:00:00Z
    const yesterday = new Date("2026-07-09T04:00:00Z");
    expect(shouldSuppressActionDigest(yesterday, now)).toBe(false);
  });

  it("returns false when lastActionDigestSentAt is 1 ms before Manila midnight today", () => {
    // Manila midnight today = 2026-07-09T16:00:00Z; 1 ms before = yesterday Manila
    const justBeforeMidnight = new Date("2026-07-09T15:59:59.999Z");
    expect(shouldSuppressActionDigest(justBeforeMidnight, now)).toBe(false);
  });

  it("returns false when lastActionDigestSentAt is tomorrow Manila", () => {
    // This shouldn't happen in practice but the function should still handle it correctly
    const tomorrow = new Date("2026-07-10T16:00:00Z"); // Manila midnight Jul 11
    expect(shouldSuppressActionDigest(tomorrow, now)).toBe(false);
  });
});

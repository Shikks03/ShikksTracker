/**
 * Unit tests for pure helpers in src/lib/sequence.ts.
 *
 * These tests pin CURRENT behavior as a regression baseline before
 * Task 3.7 (window off-by-one + small correctness fixes) changes expectations.
 *
 * Manila = fixed UTC+8, no DST. All times expressed in UTC; Manila civil time
 * is always UTC + 8 hours.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ---------------------------------------------------------------------------
// Lightweight model mocks for advanceContactAfterSend, which touches Contact/
// EmailLog/Campaign. No mongodb-memory-server or other heavyweight test
// infrastructure exists in this project (every other test in this file is a
// pure, no-DB helper) — vi.mock over the three model modules is the smallest
// addition that lets advanceContactAfterSend's branching be asserted without
// a live MongoDB connection. Mocking here does not affect the pure-function
// tests below since none of them touch these models at runtime.
// ---------------------------------------------------------------------------

vi.mock("@/models/Contact", () => ({
  default: { findOneAndUpdate: vi.fn() },
}));
vi.mock("@/models/EmailLog", () => ({
  default: { findOne: vi.fn() },
}));
vi.mock("@/models/Campaign", () => ({
  default: { findById: vi.fn() },
}));

import {
  getManilaHour,
  isWithinSendWindow,
  getManilaDayStart,
  computeNextSendAt,
  computeRelativeNextSendAt,
  isStaleSending,
  advanceContactAfterSend,
  EMAIL_CHANNEL_QUERY,
} from "@/lib/sequence";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Campaign from "@/models/Campaign";
import type { IContact } from "@/models/Contact";
import type { IEmailLog } from "@/models/EmailLog";

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

  it("returns false for Manila hour 18 (window closed boundary — exclusive upper bound)", () => {
    // Manila 18:00 = UTC 2026-07-04T10:00:00Z
    // The engine excludes hour 18 (exclusive upper bound: hour < 18).
    // Task 3.7 aligned the UI hook (useNextSendCountdown) to the same boundary
    // so the dashboard countdown no longer promises an 18:00 send slot that never fires.
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

// ---------------------------------------------------------------------------
// isStaleSending
// ---------------------------------------------------------------------------

describe("isStaleSending", () => {
  const THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes, matches STALE_SENDING_THRESHOLD_MS

  it("returns false when sendAttemptedAt is null", () => {
    const now = new Date("2026-07-04T12:00:00Z");
    expect(isStaleSending(null, now)).toBe(false);
  });

  it("returns false when elapsed time is exactly equal to the threshold", () => {
    // Boundary: elapsed === threshold is NOT stale (strictly greater-than)
    const now = new Date("2026-07-04T12:10:00Z");
    const sendAttemptedAt = new Date(now.getTime() - THRESHOLD_MS);
    expect(isStaleSending(sendAttemptedAt, now)).toBe(false);
  });

  it("returns false when elapsed time is just under the threshold", () => {
    const now = new Date("2026-07-04T12:10:00Z");
    const sendAttemptedAt = new Date(now.getTime() - THRESHOLD_MS + 1);
    expect(isStaleSending(sendAttemptedAt, now)).toBe(false);
  });

  it("returns true when elapsed time is just over the threshold", () => {
    const now = new Date("2026-07-04T12:10:00Z");
    const sendAttemptedAt = new Date(now.getTime() - THRESHOLD_MS - 1);
    expect(isStaleSending(sendAttemptedAt, now)).toBe(true);
  });

  it("returns true for a log that has been sending for 15 minutes", () => {
    const now = new Date("2026-07-04T12:15:00Z");
    const sendAttemptedAt = new Date("2026-07-04T12:00:00Z");
    expect(isStaleSending(sendAttemptedAt, now)).toBe(true);
  });

  it("returns false for a log that has been sending for 5 minutes", () => {
    const now = new Date("2026-07-04T12:05:00Z");
    const sendAttemptedAt = new Date("2026-07-04T12:00:00Z");
    expect(isStaleSending(sendAttemptedAt, now)).toBe(false);
  });

  it("returns true for a log that has been sending for over an hour (very stale)", () => {
    const now = new Date("2026-07-04T13:00:00Z");
    const sendAttemptedAt = new Date("2026-07-04T11:00:00Z");
    expect(isStaleSending(sendAttemptedAt, now)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceContactAfterSend (Phase 3 extraction — pure refactor of sendOneLog's
// Contact-advancement tail, shared with Phase 4's manual mark-sent path)
// ---------------------------------------------------------------------------

describe("advanceContactAfterSend", () => {
  const CONTACT_ID = "contact123";
  const CAMPAIGN_ID = "campaign123";

  beforeEach(() => {
    // Default: the guarded update matches (truthy result = "applied"). Tests
    // exercising the no-op path override this with mockResolvedValueOnce(null).
    vi.mocked(Contact.findOneAndUpdate).mockReset().mockResolvedValue({});
    vi.mocked(EmailLog.findOne).mockReset();
    vi.mocked(Campaign.findById).mockReset();
  });

  it("stage 1: sets pipelineStage to 'contacted' when previously 'not_started'", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "not_started",
    } as unknown as IContact;
    const log = { stage: 1, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-01T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    const result = await advanceContactAfterSend(contact, log, sentAt, campaign);

    expect(result).toEqual({ applied: true });
    expect(Contact.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    // Monotonic guard: the write is conditioned on currentStage < log.stage.
    expect(filter).toMatchObject({ _id: CONTACT_ID, currentStage: { $lt: 1 } });
    expect(update).toMatchObject({ currentStage: 1, pipelineStage: "contacted" });
    // stage 1 -> next stage 2 -> spacingDays[1] = 5 days from firstSentAt (= sentAt)
    expect((update.nextSendAt as Date).toISOString()).toBe("2026-07-06T00:00:00.000Z");
    // stage 1 skips the stage-1-lookup query entirely (firstSentAt = sentAt directly)
    expect(EmailLog.findOne).not.toHaveBeenCalled();
  });

  it("stage 1: does NOT set pipelineStage when the contact is already past 'not_started'", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "contacted",
    } as unknown as IContact;
    const log = { stage: 1, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-01T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    await advanceContactAfterSend(contact, log, sentAt, campaign);

    const [, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    expect(update).not.toHaveProperty("pipelineStage");
    expect(update.currentStage).toBe(1);
  });

  it("stage 2: computes nextSendAt from the stage-1 log's sentAt, not the stage-2 send time (in-order, regression guard)", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "contacted",
    } as unknown as IContact;
    const log = { stage: 2, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const stage2SentAt = new Date("2026-07-10T00:00:00Z"); // current (stage-2) send time
    const stage1SentAt = new Date("2026-07-01T00:00:00Z"); // earlier stage-1 send time
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    (EmailLog.findOne as unknown as Mock).mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ sentAt: stage1SentAt }) }),
    });

    const result = await advanceContactAfterSend(contact, log, stage2SentAt, campaign);

    expect(result).toEqual({ applied: true });
    const [filter, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    expect(filter).toMatchObject({ _id: CONTACT_ID, currentStage: { $lt: 2 } });
    expect(update.currentStage).toBe(2);
    // stage 2 -> next stage 3 -> spacingDays[2] = 9 days from stage1SentAt (NOT stage2SentAt)
    // Absolute anchoring is UNCHANGED from before the fix whenever a stage-1 log exists.
    expect((update.nextSendAt as Date).toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("stage 3: sets nextSendAt to null", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "contacted",
    } as unknown as IContact;
    const log = { stage: 3, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-15T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    const result = await advanceContactAfterSend(contact, log, sentAt, campaign);

    expect(result).toEqual({ applied: true });
    const [filter, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    expect(filter).toMatchObject({ _id: CONTACT_ID, currentStage: { $lt: 3 } });
    expect(update.currentStage).toBe(3);
    expect(update.nextSendAt).toBeNull();
    // stage 3 has no "next stage" to anchor, so it never needs the stage-1 lookup.
    expect(EmailLog.findOne).not.toHaveBeenCalled();
  });

  it("a contact already past 'not_started' is not regressed at stage 2 either", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "replied",
    } as unknown as IContact;
    const log = { stage: 2, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-10T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    (EmailLog.findOne as unknown as Mock).mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve(null) }),
    });

    await advanceContactAfterSend(contact, log, sentAt, campaign);

    const [, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    expect(update).not.toHaveProperty("pipelineStage");
  });

  it("loads sequenceSpacingDays from Campaign when the campaign param is omitted", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "not_started",
    } as unknown as IContact;
    const log = { stage: 1, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-01T00:00:00Z");

    (Campaign.findById as unknown as Mock).mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve({ sequenceSpacingDays: [0, 7, 14] }) }),
    });

    await advanceContactAfterSend(contact, log, sentAt);

    expect(Campaign.findById).toHaveBeenCalledWith(CAMPAIGN_ID);
    const [, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    // stage 1 -> next stage 2 -> spacingDays[1] = 7 days from sentAt
    expect((update.nextSendAt as Date).toISOString()).toBe("2026-07-08T00:00:00.000Z");
  });

  it("falls back to the [0,5,9] default when the campaign lookup finds nothing", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "not_started",
    } as unknown as IContact;
    const log = { stage: 1, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-01T00:00:00Z");

    (Campaign.findById as unknown as Mock).mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve(null) }),
    });

    await advanceContactAfterSend(contact, log, sentAt);

    const [, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    expect((update.nextSendAt as Date).toISOString()).toBe("2026-07-06T00:00:00.000Z");
  });

  // -------------------------------------------------------------------------
  // Monotonic guard (Bug 2a): the conditional update is a no-op, not an
  // error, when the contact's currentStage is already >= log.stage — this is
  // what prevents a slow/out-of-order lower-stage request from clobbering a
  // higher stage a faster/concurrent request already wrote.
  // -------------------------------------------------------------------------

  it("returns applied:false (no-op) when the guarded Contact update finds no match", async () => {
    (Contact.findOneAndUpdate as unknown as Mock).mockResolvedValueOnce(null);

    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "contacted",
    } as unknown as IContact;
    // Simulates a stage-1 mark arriving late after a stage-3 log already advanced
    // the contact to currentStage 3 in the DB (the mock returning null stands in
    // for "no document matched currentStage < 1").
    const log = { stage: 1, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-01T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    const result = await advanceContactAfterSend(contact, log, sentAt, campaign);

    expect(result.applied).toBe(false);
    if (!result.applied) {
      expect(result.reason).toMatch(/no-op/i);
    }
  });

  // -------------------------------------------------------------------------
  // Missing stage-1-anchor fallback (Bug 2b): a stage-2 (or higher) log sent
  // with no stage-1 `sent` log to anchor to must use RELATIVE spacing from
  // THIS send, not the wrong absolute offset.
  // -------------------------------------------------------------------------

  it("stage 2 with NO stage-1 log: schedules stage 3 using relative spacing (4 days with [0,5,9]), not absolute 9 days", async () => {
    const contact = {
      _id: CONTACT_ID,
      pipelineStage: "contacted",
    } as unknown as IContact;
    const log = { stage: 2, campaignId: CAMPAIGN_ID } as unknown as IEmailLog;
    const sentAt = new Date("2026-07-10T00:00:00Z");
    const campaign = { sequenceSpacingDays: [0, 5, 9] };

    (EmailLog.findOne as unknown as Mock).mockReturnValueOnce({
      select: () => ({ lean: () => Promise.resolve(null) }), // no stage-1 sent log
    });

    await advanceContactAfterSend(contact, log, sentAt, campaign);

    const [, update] = (Contact.findOneAndUpdate as unknown as Mock).mock.calls[0];
    // 9 - 5 = 4 days from sentAt, NOT 9 days (which the old absolute-fallback bug produced)
    expect((update.nextSendAt as Date).toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// computeRelativeNextSendAt — the missing-stage-1-anchor fallback helper
// ---------------------------------------------------------------------------

describe("computeRelativeNextSendAt", () => {
  const sentAt = new Date("2026-07-10T00:00:00Z");

  it("computes the 5->9 gap (4 days) for a stage-2 send with no stage-1 anchor, default [0,5,9] spacing", () => {
    const result = computeRelativeNextSendAt(sentAt, [0, 5, 9], 2, 3);
    expect(result.toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("respects custom spacing values", () => {
    // [0, 7, 14]: stage2->3 gap = 14 - 7 = 7 days
    const result = computeRelativeNextSendAt(sentAt, [0, 7, 14], 2, 3);
    expect(result.toISOString()).toBe("2026-07-17T00:00:00.000Z");
  });

  it("falls back to canonical day offsets for a short/malformed spacing array (no NaN)", () => {
    // Empty array: both indices missing -> fallback 5 (stage2), 9 (stage3) -> gap 4
    const result = computeRelativeNextSendAt(sentAt, [], 2, 3);
    expect(Number.isNaN(result.getTime())).toBe(false);
    expect(result.toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("falls back to canonical day offsets when only the earlier index is missing", () => {
    // [0]: index 1 (stage 2) missing -> fallback 5; index 2 (stage 3) present -> 9 -> gap 4
    const result = computeRelativeNextSendAt(sentAt, [0], 2, 3);
    expect(result.toISOString()).toBe("2026-07-14T00:00:00.000Z");
  });

  it("clamps a negative interval to 0 days (send immediately) rather than going negative", () => {
    // Malformed/out-of-order spacing: stage 2 configured AFTER stage 3's offset.
    const result = computeRelativeNextSendAt(sentAt, [0, 20, 5], 2, 3);
    expect(result.toISOString()).toBe(sentAt.toISOString());
  });
});

// ---------------------------------------------------------------------------
// EMAIL_CHANNEL_QUERY — the predicate guarding sendApproved's daily-cap
// counter and approved-logs query. sendApproved itself is not exported (and
// exercising it end-to-end would require a live Mongo connection), so this
// tests the exported query-shape constant directly: a small hand-rolled
// matcher that understands exactly the two clause shapes this predicate
// uses (equality, and $exists:false) is enough to pin the intended semantics
// without a MongoDB connection or a query-evaluation library.
// ---------------------------------------------------------------------------

describe("EMAIL_CHANNEL_QUERY", () => {
  function matchesEmailChannelQuery(doc: { channel?: string | null }): boolean {
    return EMAIL_CHANNEL_QUERY.$or.some((clause) => {
      if (
        typeof clause.channel === "object" &&
        clause.channel !== null &&
        "$exists" in clause.channel
      ) {
        return !("channel" in doc);
      }
      return doc.channel === clause.channel;
    });
  }

  it("matches an explicit email-channel log", () => {
    expect(matchesEmailChannelQuery({ channel: "email" })).toBe(true);
  });

  it("matches a legacy log with no channel field at all (pre-migration)", () => {
    expect(matchesEmailChannelQuery({})).toBe(true);
  });

  it("matches a legacy log with channel explicitly null", () => {
    expect(matchesEmailChannelQuery({ channel: null })).toBe(true);
  });

  it("does NOT match a facebook-channel log", () => {
    expect(matchesEmailChannelQuery({ channel: "facebook" })).toBe(false);
  });

  it("does NOT match an instagram-channel log", () => {
    expect(matchesEmailChannelQuery({ channel: "instagram" })).toBe(false);
  });

  it("does NOT match a phone-channel log", () => {
    expect(matchesEmailChannelQuery({ channel: "phone" })).toBe(false);
  });
});

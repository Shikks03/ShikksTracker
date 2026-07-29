/**
 * Unit tests for src/lib/outreachLogs.ts — the multi-channel "Outreach Tasks"
 * board helpers (Phase 4, API half).
 *
 * No DB integration harness exists in this project — every test here is a
 * pure-function test, matching the style of EMAIL_CHANNEL_QUERY's tests in
 * sequence.test.ts (a hand-rolled matcher asserting the query-shape constant
 * directly, without a live MongoDB connection or a query-evaluation library).
 */

import { describe, it, expect } from "vitest";
import {
  NON_EMAIL_CHANNEL_QUERY,
  isNonEmailChannel,
  checkMarkSentAllowed,
  VALID_OUTREACH_LOG_STATUSES,
} from "@/lib/outreachLogs";

// ---------------------------------------------------------------------------
// NON_EMAIL_CHANNEL_QUERY — the predicate guarding GET /api/outreach-logs.
// Must be the inverse of EMAIL_CHANNEL_QUERY: match facebook/instagram/phone,
// and NOT match an explicit "email" channel or a legacy log with the channel
// field absent/null (those are email logs in disguise, per sequence.ts).
// ---------------------------------------------------------------------------

describe("NON_EMAIL_CHANNEL_QUERY", () => {
  function matchesNonEmailChannelQuery(doc: { channel?: string | null }): boolean {
    return NON_EMAIL_CHANNEL_QUERY.channel.$in.some((c) => doc.channel === c);
  }

  it("matches a facebook-channel log", () => {
    expect(matchesNonEmailChannelQuery({ channel: "facebook" })).toBe(true);
  });

  it("matches an instagram-channel log", () => {
    expect(matchesNonEmailChannelQuery({ channel: "instagram" })).toBe(true);
  });

  it("matches a phone-channel log", () => {
    expect(matchesNonEmailChannelQuery({ channel: "phone" })).toBe(true);
  });

  it("does NOT match an explicit email-channel log", () => {
    expect(matchesNonEmailChannelQuery({ channel: "email" })).toBe(false);
  });

  it("does NOT match a legacy log with no channel field at all (pre-migration email)", () => {
    expect(matchesNonEmailChannelQuery({})).toBe(false);
  });

  it("does NOT match a legacy log with channel explicitly null", () => {
    expect(matchesNonEmailChannelQuery({ channel: null })).toBe(false);
  });

  it("is not implemented as $ne: 'email' (would wrongly match channel-less legacy logs)", () => {
    // Guard against a regression to `{ channel: { $ne: "email" } }`, which the
    // task spec explicitly calls out as wrong: it would ALSO match legacy
    // logs with no channel field, which are actually email logs.
    expect(NON_EMAIL_CHANNEL_QUERY.channel).not.toHaveProperty("$ne");
    expect([...NON_EMAIL_CHANNEL_QUERY.channel.$in].sort()).toEqual(
      ["facebook", "instagram", "phone"].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// isNonEmailChannel
// ---------------------------------------------------------------------------

describe("isNonEmailChannel", () => {
  it("returns true for facebook/instagram/phone", () => {
    expect(isNonEmailChannel("facebook")).toBe(true);
    expect(isNonEmailChannel("instagram")).toBe(true);
    expect(isNonEmailChannel("phone")).toBe(true);
  });

  it("returns false for email", () => {
    expect(isNonEmailChannel("email")).toBe(false);
  });

  it("returns false for garbage input", () => {
    expect(isNonEmailChannel("carrier-pigeon")).toBe(false);
    expect(isNonEmailChannel("")).toBe(false);
  });

  it("returns false for null/undefined (legacy pre-migration logs = email)", () => {
    expect(isNonEmailChannel(null)).toBe(false);
    expect(isNonEmailChannel(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VALID_OUTREACH_LOG_STATUSES
// ---------------------------------------------------------------------------

describe("VALID_OUTREACH_LOG_STATUSES", () => {
  it("accepts all four EmailLog statuses", () => {
    for (const s of ["draft", "approved", "sending", "sent"]) {
      expect(VALID_OUTREACH_LOG_STATUSES.has(s)).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(VALID_OUTREACH_LOG_STATUSES.has("bogus")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkMarkSentAllowed — the guard for POST /api/outreach-logs/[id]/mark-sent
// ---------------------------------------------------------------------------

describe("checkMarkSentAllowed", () => {
  it("rejects channel: 'email' with 400, regardless of status", () => {
    for (const status of ["draft", "approved", "sending", "sent"] as const) {
      const result = checkMarkSentAllowed({ channel: "email", status });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.httpStatus).toBe(400);
        expect(result.error).toMatch(/gmail/i);
      }
    }
  });

  it("rejects an already-sent non-email log with 409", () => {
    const result = checkMarkSentAllowed({ channel: "facebook", status: "sent" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
      expect(result.error).toMatch(/already/i);
    }
  });

  it("rejects a non-email log currently 'sending' with 409", () => {
    const result = checkMarkSentAllowed({ channel: "instagram", status: "sending" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(409);
    }
  });

  it("allows a draft non-email log", () => {
    expect(checkMarkSentAllowed({ channel: "facebook", status: "draft" })).toEqual({ ok: true });
  });

  it("allows an approved non-email log", () => {
    expect(checkMarkSentAllowed({ channel: "phone", status: "approved" })).toEqual({ ok: true });
  });

  it("allows all three non-email channels when draft", () => {
    for (const channel of ["facebook", "instagram", "phone"] as const) {
      expect(checkMarkSentAllowed({ channel, status: "draft" })).toEqual({ ok: true });
    }
  });

  it("rejects a legacy log with channel undefined/null with 400 (treated as email)", () => {
    for (const status of ["draft", "approved", "sending", "sent"] as const) {
      const undefinedResult = checkMarkSentAllowed({ channel: undefined, status });
      expect(undefinedResult.ok).toBe(false);
      if (!undefinedResult.ok) expect(undefinedResult.httpStatus).toBe(400);

      const nullResult = checkMarkSentAllowed({ channel: null, status });
      expect(nullResult.ok).toBe(false);
      if (!nullResult.ok) expect(nullResult.httpStatus).toBe(400);
    }
  });
});

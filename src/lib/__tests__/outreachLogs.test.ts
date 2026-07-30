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
  DEFAULT_OUTREACH_LOG_STATUSES,
  resolveOutreachLogStatusFilter,
  isSubjectRequiredForChannel,
  isSubjectRequiredForChannels,
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

// ---------------------------------------------------------------------------
// resolveOutreachLogStatusFilter — the status filter for GET /api/outreach-logs
// ---------------------------------------------------------------------------

describe("resolveOutreachLogStatusFilter", () => {
  it("defaults to both draft and approved when status is absent (null)", () => {
    const result = resolveOutreachLogStatusFilter(null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter).toEqual({ status: { $in: DEFAULT_OUTREACH_LOG_STATUSES } });
      expect([...(result.filter as { status: { $in: readonly string[] } }).status.$in].sort()).toEqual(
        ["approved", "draft"]
      );
    }
  });

  it("matches exactly 'sent' when status=sent is supplied (not 'sent or approved')", () => {
    const result = resolveOutreachLogStatusFilter("sent");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter).toEqual({ status: "sent" });
    }
  });

  it("matches exactly 'draft' when status=draft is supplied explicitly", () => {
    const result = resolveOutreachLogStatusFilter("draft");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter).toEqual({ status: "draft" });
    }
  });

  it("matches exactly 'approved' when status=approved is supplied explicitly", () => {
    const result = resolveOutreachLogStatusFilter("approved");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter).toEqual({ status: "approved" });
    }
  });

  it("matches exactly 'sending' when status=sending is supplied explicitly", () => {
    const result = resolveOutreachLogStatusFilter("sending");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filter).toEqual({ status: "sending" });
    }
  });

  it("400s on an invalid status", () => {
    const result = resolveOutreachLogStatusFilter("bogus");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(400);
      expect(result.error).toMatch(/invalid status/i);
    }
  });
});

// ---------------------------------------------------------------------------
// isSubjectRequiredForChannel — conditional subject rule for POST /api/email-logs
// ---------------------------------------------------------------------------

describe("isSubjectRequiredForChannel", () => {
  it("requires a subject for email", () => {
    expect(isSubjectRequiredForChannel("email")).toBe(true);
  });

  it("requires a subject for a legacy channel-less contact/log (treated as email)", () => {
    expect(isSubjectRequiredForChannel(null)).toBe(true);
    expect(isSubjectRequiredForChannel(undefined)).toBe(true);
  });

  it("does not require a subject for facebook, instagram, or phone", () => {
    expect(isSubjectRequiredForChannel("facebook")).toBe(false);
    expect(isSubjectRequiredForChannel("instagram")).toBe(false);
    expect(isSubjectRequiredForChannel("phone")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSubjectRequiredForChannels — batch-level version for POST
// /api/email-logs/batch and the /compose multi-select form, where a single
// submission can mix email and facebook/instagram/phone recipients.
// ---------------------------------------------------------------------------

describe("isSubjectRequiredForChannels", () => {
  it("does not require a subject when every channel is non-email", () => {
    expect(isSubjectRequiredForChannels(["facebook", "instagram", "phone"])).toBe(false);
  });

  it("requires a subject when the selection mixes one email contact in with non-email ones", () => {
    expect(isSubjectRequiredForChannels(["facebook", "email", "phone"])).toBe(true);
  });

  it("requires a subject when every channel is email", () => {
    expect(isSubjectRequiredForChannels(["email", "email"])).toBe(true);
  });

  it("requires a subject when the selection contains a legacy null/undefined channel (treated as email)", () => {
    expect(isSubjectRequiredForChannels(["facebook", null])).toBe(true);
    expect(isSubjectRequiredForChannels(["facebook", undefined])).toBe(true);
  });

  // Empty-selection edge case: an empty list has no email recipient to
  // require a subject for, so this returns false ("not required"). It is
  // the caller's separate "select at least one recipient" validation that
  // rejects an empty selection outright — this helper never sees that case
  // in practice because both call sites (POST /api/email-logs/batch and
  // /compose's validate()) check recipient count first.
  it("does not require a subject for an empty channel list", () => {
    expect(isSubjectRequiredForChannels([])).toBe(false);
  });
});

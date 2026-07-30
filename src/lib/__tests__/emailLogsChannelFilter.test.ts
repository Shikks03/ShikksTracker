/**
 * Unit tests for applyChannelFilter, the `?channel=` predicate builder for
 * GET /api/email-logs (src/app/api/email-logs/route.ts).
 *
 * Regression coverage for the bug where `channel=email` was turned into a
 * bare `filter.channel = "email"` equality check: legacy EmailLogs written
 * before the `channel` field existed (absent/null) would then vanish from
 * the /review approval queue even though cron auto-send (which uses the
 * migration-safe EMAIL_CHANNEL_QUERY) still picks them up and sends them.
 *
 * Only the pure filter-building function is exercised here — GET() itself is
 * never invoked, so no DB/model mocking is required (importing the route
 * module is safe with no live Mongo connection, same as sequence.test.ts
 * importing @/lib/sequence directly).
 */

import { describe, it, expect } from "vitest";
import { applyChannelFilter } from "@/app/api/email-logs/route";
import { EMAIL_CHANNEL_QUERY } from "@/lib/sequence";

describe("applyChannelFilter", () => {
  it("400s on an invalid channel value", () => {
    const filter: Record<string, unknown> = {};
    const result = applyChannelFilter(filter, "carrier-pigeon");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(400);
      expect(result.error).toMatch(/channel must be one of/i);
    }
    // Filter must be left untouched on rejection
    expect(filter).toEqual({});
  });

  it("rejects every value that isn't one of the four known channels", () => {
    for (const bad of ["Email", "EMAIL", "sms", "", "whatsapp"]) {
      const result = applyChannelFilter({}, bad);
      expect(result.ok).toBe(false);
    }
  });

  it("channel=email applies the migration-safe EMAIL_CHANNEL_QUERY (matches legacy absent/null channel too)", () => {
    const filter: Record<string, unknown> = { status: "draft" };
    const result = applyChannelFilter(filter, "email");
    expect(result.ok).toBe(true);
    expect(filter).toEqual({ status: "draft", ...EMAIL_CHANNEL_QUERY });

    // Sanity: the resulting $or actually matches an explicit "email" log,
    // a legacy log with no channel field, and a legacy log with channel: null —
    // and does NOT match a facebook log.
    const or = (filter.$or as Array<{ channel: unknown }>) ?? [];
    const matches = (doc: Record<string, unknown>) =>
      or.some(({ channel: clauseChannel }) => {
        // The $exists clause shape must be checked BEFORE a plain equality
        // comparison — clause.channel is itself `{ $exists: false }` there,
        // not a scalar, so `doc.channel === clauseChannel` would (correctly)
        // return false for every doc and never signal a match.
        if (
          clauseChannel &&
          typeof clauseChannel === "object" &&
          "$exists" in clauseChannel
        ) {
          const hasChannelKey = "channel" in doc;
          return (clauseChannel as { $exists: boolean }).$exists === false
            ? !hasChannelKey
            : hasChannelKey;
        }
        return doc.channel === clauseChannel;
      });

    expect(matches({ channel: "email" })).toBe(true);
    expect(matches({})).toBe(true); // no channel field at all (legacy)
    expect(matches({ channel: null })).toBe(true);
    expect(matches({ channel: "facebook" })).toBe(false);
  });

  it("a non-email channel (facebook/instagram/phone) uses exact equality, not EMAIL_CHANNEL_QUERY", () => {
    for (const channel of ["facebook", "instagram", "phone"]) {
      const filter: Record<string, unknown> = {};
      const result = applyChannelFilter(filter, channel);
      expect(result.ok).toBe(true);
      expect(filter).toEqual({ channel });
      expect(filter.$or).toBeUndefined();
    }
  });

  it("combines via $and instead of clobbering a pre-existing $or when channel=email is applied", () => {
    const preexistingOr = [{ status: "draft" }, { status: "approved" }];
    const filter: Record<string, unknown> = { $or: preexistingOr };
    const result = applyChannelFilter(filter, "email");
    expect(result.ok).toBe(true);
    expect(filter.$or).toBeUndefined();
    expect(filter.$and).toEqual([{ $or: preexistingOr }, EMAIL_CHANNEL_QUERY]);
  });

  it("leaves other filter keys (contactId, campaignId, status) untouched", () => {
    const filter: Record<string, unknown> = {
      contactId: "abc",
      campaignId: "def",
      status: "sent",
    };
    applyChannelFilter(filter, "phone");
    expect(filter).toEqual({
      contactId: "abc",
      campaignId: "def",
      status: "sent",
      channel: "phone",
    });
  });
});

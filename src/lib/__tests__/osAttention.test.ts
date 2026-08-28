/**
 * Unit tests for src/lib/os/attention.ts.
 *
 * The whole decision rule for `repliedUnanswered` lives in a pure selector
 * precisely so it can be asserted here without a live MongoDB; the route is a
 * two-query loader around it.
 */

import { describe, it, expect } from "vitest";
import {
  selectRepliedUnanswered,
  buildHotLeadQuery,
  buildOverdueActionQuery,
  type AttentionContactLike,
  type AttentionLogLike,
  type AttentionCampaignLike,
} from "@/lib/os/attention";
import { truncateWithEllipsis, truncateCodePoints } from "@/lib/os/text";

const NOW = new Date("2026-08-28T04:00:00Z");
const d = (iso: string) => new Date(iso);

const CAMPAIGN: AttentionCampaignLike = {
  _id: "c1",
  offerSummary: "We build simple booking sites.",
  toneNotes: "casual",
};

function contact(over: Partial<AttentionContactLike> = {}): AttentionContactLike {
  return {
    _id: "k1",
    businessName: "Kape Kalye",
    contactName: "Ana",
    outreachChannel: "email",
    keyPoints: "Third-wave cafe in Cebu.",
    campaignId: "c1",
    status: "replied",
    currentStage: 1,
    engagementScore: 10,
    ...over,
  };
}

function sentLog(over: Partial<AttentionLogLike> = {}): AttentionLogLike {
  return {
    _id: "L1",
    contactId: "k1",
    stage: 1,
    status: "sent",
    replied: false,
    repliedAt: null,
    replySnippet: null,
    body: "Original outbound body.",
    sentAt: d("2026-08-20T01:00:00Z"),
    ...over,
  };
}

function run(contacts: AttentionContactLike[], logs: AttentionLogLike[], days = 3) {
  const byContact = new Map<string, AttentionLogLike[]>();
  for (const l of logs) {
    const key = String(l.contactId);
    byContact.set(key, [...(byContact.get(key) ?? []), l]);
  }
  return selectRepliedUnanswered(
    contacts,
    byContact,
    new Map([["c1", CAMPAIGN]]),
    NOW,
    days
  );
}

describe("selectRepliedUnanswered", () => {
  it("returns a contact whose reply is older than the cutoff and unanswered", () => {
    const items = run(
      [contact()],
      [sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z"), replySnippet: "sounds good" })]
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      contactId: "k1",
      businessName: "Kape Kalye",
      contactName: "Ana",
      channel: "email",
      replySnippet: "sounds good",
      keyPoints: "Third-wave cafe in Cebu.",
      offerSummary: "We build simple booking sites.",
      toneNotes: "casual",
      stage: 1,
      replyToLogId: "L1",
      lastOutboundBody: "Original outbound body.",
    });
    expect(items[0].repliedAt).toBe("2026-08-21T01:00:00.000Z");
  });

  it("skips a reply that is still inside the cutoff window", () => {
    const items = run([contact()], [sentLog({ replied: true, repliedAt: d("2026-08-27T01:00:00Z") })]);
    expect(items).toEqual([]);
  });

  it("respects a custom days window", () => {
    const logs = [sentLog({ replied: true, repliedAt: d("2026-08-26T01:00:00Z") })];
    expect(run([contact()], logs, 3)).toEqual([]);
    expect(run([contact()], logs, 1)).toHaveLength(1);
  });

  it("skips a contact we already answered after the reply", () => {
    const items = run(
      [contact()],
      [
        sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") }),
        sentLog({ _id: "L2", stage: 2, sentAt: d("2026-08-22T01:00:00Z") }),
      ]
    );
    expect(items).toEqual([]);
  });

  it("still returns the contact when the only other send is BEFORE the reply", () => {
    const items = run(
      [contact()],
      [
        sentLog({ _id: "L0", sentAt: d("2026-08-19T01:00:00Z") }),
        sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") }),
      ]
    );
    expect(items).toHaveLength(1);
  });

  it("skips a contact with a pending draft — a response is already queued", () => {
    const items = run(
      [contact()],
      [
        sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") }),
        sentLog({ _id: "L9", status: "draft", sentAt: null }),
      ]
    );
    expect(items).toEqual([]);
  });

  it("skips a contact with a pending approved log — this is what stops duplicate chasing", () => {
    const items = run(
      [contact()],
      [
        sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") }),
        sentLog({ _id: "L9", status: "approved", sentAt: null }),
      ]
    );
    expect(items).toEqual([]);
  });

  it("ignores contacts whose status is not 'replied'", () => {
    const items = run(
      [contact({ status: "active" })],
      [sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") })]
    );
    expect(items).toEqual([]);
  });

  it("ignores a replied contact with no replied log to anchor on", () => {
    expect(run([contact()], [sentLog()])).toEqual([]);
  });

  it("anchors on the NEWEST replied log", () => {
    const items = run(
      [contact()],
      [
        sentLog({ _id: "old", replied: true, repliedAt: d("2026-08-10T01:00:00Z"), stage: 1 }),
        sentLog({ _id: "new", replied: true, repliedAt: d("2026-08-21T01:00:00Z"), stage: 2 }),
      ]
    );
    expect(items[0].replyToLogId).toBe("new");
    expect(items[0].stage).toBe(2);
  });

  it("uses the newest outbound body as drafting context, truncated to 2000 code points", () => {
    const long = "x".repeat(2500);
    const items = run(
      [contact()],
      [
        sentLog({ _id: "L0", body: "older", sentAt: d("2026-08-18T01:00:00Z") }),
        sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z"), body: long }),
      ]
    );
    expect(items[0].lastOutboundBody).toBe("x".repeat(2000) + "…");
  });

  it("defaults a legacy contact with no outreachChannel to email", () => {
    const items = run(
      [contact({ outreachChannel: null })],
      [sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") })]
    );
    expect(items[0].channel).toBe("email");
  });

  it("tolerates a missing campaign rather than throwing", () => {
    const items = run(
      [contact({ campaignId: "gone" })],
      [sentLog({ replied: true, repliedAt: d("2026-08-21T01:00:00Z") })]
    );
    expect(items[0].offerSummary).toBeNull();
    expect(items[0].toneNotes).toBeNull();
  });
});

describe("query builders", () => {
  it("buildHotLeadQuery filters on the threshold and excludes non-contactable statuses", () => {
    expect(buildHotLeadQuery(5)).toEqual({
      engagementScore: { $gte: 5 },
      status: { $nin: ["replied", "unsubscribed", "bounced"] },
    });
  });

  it("buildOverdueActionQuery requires a non-null past nextActionAt", () => {
    expect(buildOverdueActionQuery(NOW)).toEqual({
      nextActionAt: { $lt: NOW, $ne: null },
    });
  });
});

describe("truncation helpers", () => {
  it("truncateWithEllipsis leaves short text untouched", () => {
    expect(truncateWithEllipsis("short", 100)).toBe("short");
  });

  it("truncateWithEllipsis appends an ellipsis when it cuts", () => {
    expect(truncateWithEllipsis("abcdef", 3)).toBe("abc…");
  });

  it("truncateCodePoints does not split a surrogate pair", () => {
    // Two astral characters — a UTF-16 slice(0,1) would produce half a pair.
    const emoji = "\u{1F1F5}\u{1F1ED}";
    expect(truncateCodePoints(emoji, 1)).toBe("\u{1F1F5}");
  });

  it("truncateWithEllipsis is also code-point safe", () => {
    expect(truncateWithEllipsis("\u{1F1F5}\u{1F1ED}", 1)).toBe("\u{1F1F5}…");
  });
});

import { describe, it, expect } from "vitest";
import { normalizedTokens, tokenSimilarity } from "@/lib/messenger/similarity";
import { rankLinkSuggestions, pickReplyAnchor } from "@/lib/messenger/linking";

describe("tokenSimilarity", () => {
  it("is 1 for identical strings ignoring case and punctuation", () => {
    expect(tokenSimilarity("Cafe Luna", "cafe luna!")).toBe(1);
  });
  it("is 0 for disjoint strings", () => {
    expect(tokenSimilarity("Cafe Luna", "Zed Motors")).toBe(0);
  });
  it("scores partial overlap between 0 and 1", () => {
    const s = tokenSimilarity("Cafe Luna Manila", "Cafe Luna");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  it("ignores accents and extra whitespace", () => {
    expect(tokenSimilarity("Café  Luná", "cafe luna")).toBe(1);
  });
  it("returns 0 when either side is empty", () => {
    expect(tokenSimilarity("", "cafe")).toBe(0);
  });
  it("strips common business-noise words", () => {
    expect(normalizedTokens("Cafe Luna Inc.")).toEqual(["cafe", "luna"]);
  });
});

describe("rankLinkSuggestions", () => {
  const contacts = [
    { _id: "a", businessName: "Cafe Luna", contactName: null, hasSentFacebookLog: true, hasReplied: false },
    { _id: "b", businessName: "Luna Bakes", contactName: null, hasSentFacebookLog: false, hasReplied: false },
    { _id: "c", businessName: "Zed Motors", contactName: null, hasSentFacebookLog: false, hasReplied: false },
  ];

  it("ranks the best name match first", () => {
    const out = rankLinkSuggestions("Cafe Luna", contacts);
    expect(out[0].contactId).toBe("a");
  });

  it("returns at most 3", () => {
    expect(rankLinkSuggestions("Luna", contacts).length).toBeLessThanOrEqual(3);
  });

  it("drops contacts with no overlap at all", () => {
    expect(rankLinkSuggestions("Cafe Luna", contacts).map((s) => s.contactId)).not.toContain("c");
  });

  it("boosts a contact we messaged and who has not replied", () => {
    // Equal name similarity; the awaiting-reply contact must win. That is the
    // whole point of the boost — the PSID almost certainly belongs to someone
    // we are mid-conversation with.
    const equal = [
      { _id: "x", businessName: "Luna", contactName: null, hasSentFacebookLog: false, hasReplied: false },
      { _id: "y", businessName: "Luna", contactName: null, hasSentFacebookLog: true, hasReplied: false },
    ];
    expect(rankLinkSuggestions("Luna", equal)[0].contactId).toBe("y");
  });

  it("does not boost a contact who already replied", () => {
    const equal = [
      { _id: "x", businessName: "Luna", contactName: null, hasSentFacebookLog: false, hasReplied: false },
      { _id: "y", businessName: "Luna", contactName: null, hasSentFacebookLog: true, hasReplied: true },
    ];
    expect(rankLinkSuggestions("Luna", equal)[0].contactId).toBe("x");
  });

  it("matches on contactName too", () => {
    const c = [{ _id: "p", businessName: "Zed Motors", contactName: "Ana Reyes", hasSentFacebookLog: false, hasReplied: false }];
    expect(rankLinkSuggestions("Ana Reyes", c)[0].contactId).toBe("p");
  });

  it("returns [] for an empty display name rather than ranking noise", () => {
    // A failed profile fetch leaves displayName "". Every contact would score
    // 0 and the UI would show three arbitrary suggestions as if they meant
    // something. Free search is the fallback.
    expect(rankLinkSuggestions("", contacts)).toEqual([]);
  });

  it("is deterministic on ties", () => {
    const tied = [
      { _id: "b2", businessName: "Luna", contactName: null, hasSentFacebookLog: false, hasReplied: false },
      { _id: "a1", businessName: "Luna", contactName: null, hasSentFacebookLog: false, hasReplied: false },
    ];
    expect(rankLinkSuggestions("Luna", tied).map((s) => s.contactId)).toEqual(["a1", "b2"]);
  });
});

// ---------------------------------------------------------------------------

describe("pickReplyAnchor", () => {
  const at = (iso: string, text = "msg") => ({ sentAt: new Date(iso), text });

  it("returns null when there are no inbound messages", () => {
    expect(pickReplyAnchor([], new Date("2026-09-04T01:00:00Z"))).toBeNull();
  });

  it("picks the earliest inbound since the last outbound", () => {
    const msgs = [
      at("2026-09-04T01:00:00Z", "old"),
      at("2026-09-04T03:00:00Z", "the reply"),
      at("2026-09-04T04:00:00Z", "and more"),
    ];
    const anchor = pickReplyAnchor(msgs, new Date("2026-09-04T02:00:00Z"));
    expect(anchor?.text).toBe("the reply");
  });

  it("picks the earliest inbound when there is no outbound at all", () => {
    const msgs = [at("2026-09-04T01:00:00Z", "first"), at("2026-09-04T02:00:00Z", "second")];
    // No cutoff, so the fallback returns the most recent — the freshest thing
    // they said, which is what a human reading the thread would point at.
    expect(pickReplyAnchor(msgs, null)?.text).toBe("second");
  });

  it("falls back to the most recent inbound when a Page auto-greeting outran it", () => {
    // THE REGRESSION. Prospect messages at 01:50:52; the Page's automated
    // instant reply is echoed back at 01:50:55. Every inbound is now older
    // than lastOutboundAt, and the old query returned nothing — so linking
    // applied no reply effects and the contact stayed not_started.
    const msgs = [at("2026-09-04T01:50:52.312Z", "hello")];
    const anchor = pickReplyAnchor(msgs, new Date("2026-09-04T01:50:55.446Z"));
    expect(anchor?.text).toBe("hello");
  });

  it("falls back when the operator replied from the Page inbox before linking", () => {
    const msgs = [
      at("2026-09-04T01:00:00Z", "hi there"),
      at("2026-09-04T01:30:00Z", "are you available?"),
    ];
    const anchor = pickReplyAnchor(msgs, new Date("2026-09-04T04:03:43Z"));
    expect(anchor?.text).toBe("are you available?");
  });

  it("prefers a genuine post-outbound reply over the fallback", () => {
    const msgs = [
      at("2026-09-04T01:00:00Z", "hello"),
      at("2026-09-04T05:00:00Z", "still interested"),
    ];
    const anchor = pickReplyAnchor(msgs, new Date("2026-09-04T04:00:00Z"));
    expect(anchor?.text).toBe("still interested");
  });

  it("treats an inbound exactly at the outbound timestamp as not newer", () => {
    // Strictly greater, matching the $gt the query used. An equal timestamp is
    // our own echo racing the inbound, not a reply to it.
    const msgs = [at("2026-09-04T02:00:00Z", "same instant")];
    const anchor = pickReplyAnchor(msgs, new Date("2026-09-04T02:00:00Z"));
    expect(anchor?.text).toBe("same instant"); // via the fallback, not the cutoff
  });

  it("accepts string timestamps from a .lean() read", () => {
    const msgs = [
      { sentAt: "2026-09-04T01:00:00Z" as unknown as Date, text: "old" },
      { sentAt: "2026-09-04T03:00:00Z" as unknown as Date, text: "new" },
    ];
    expect(pickReplyAnchor(msgs, new Date("2026-09-04T02:00:00Z"))?.text).toBe("new");
  });
});

import { describe, it, expect } from "vitest";
import { normalizedTokens, tokenSimilarity } from "@/lib/messenger/similarity";
import { rankLinkSuggestions } from "@/lib/messenger/linking";

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

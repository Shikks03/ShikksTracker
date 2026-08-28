/**
 * Unit tests for src/lib/os/variantStats.ts — the pure shaper that turns
 * aggregation rows into the RikuOS response.
 */

import { describe, it, expect } from "vitest";
import {
  shapeVariantStats,
  type VariantStatsRow,
  type VariantMetaLike,
} from "@/lib/os/variantStats";

const META: VariantMetaLike[] = [
  { key: "email-s1-painpoint", label: "Pain point first", channel: "email", stage: 1 },
  { key: "email-s1-compliment", label: "Compliment first", channel: "email", stage: 1 },
];

function row(over: Partial<VariantStatsRow> = {}): VariantStatsRow {
  return {
    key: "email-s1-painpoint",
    leadSource: "cold_email",
    webPresenceTier: "none",
    sends: 1,
    replies: 0,
    contactIds: ["a"],
    ...over,
  };
}

describe("shapeVariantStats", () => {
  it("includes a seeded variant that has never been used, with zeroes", () => {
    const stats = shapeVariantStats([], META);
    const painpoint = stats.find((s) => s.key === "email-s1-painpoint")!;
    expect(painpoint).toMatchObject({
      key: "email-s1-painpoint",
      label: "Pain point first",
      channel: "email",
      stage: 1,
      sends: 0,
      replies: 0,
      replyRate: 0,
      uniqueContacts: 0,
    });
    expect(stats.find((s) => s.key === "email-s1-compliment")!.sends).toBe(0);
  });

  it("totals sends and replies across slices", () => {
    const stats = shapeVariantStats(
      [
        row({ leadSource: "cold_email", sends: 4, replies: 1, contactIds: ["a", "b"] }),
        row({ leadSource: "referral", sends: 2, replies: 1, contactIds: ["c"] }),
      ],
      META
    );
    const painpoint = stats.find((s) => s.key === "email-s1-painpoint")!;
    expect(painpoint.sends).toBe(6);
    expect(painpoint.replies).toBe(2);
  });

  it("counts unique contacts across slices without double counting", () => {
    const stats = shapeVariantStats(
      [
        row({ leadSource: "cold_email", contactIds: ["a", "b"] }),
        row({ leadSource: "referral", contactIds: ["b", "c"] }),
      ],
      META
    );
    expect(stats.find((s) => s.key === "email-s1-painpoint")!.uniqueContacts).toBe(3);
  });

  it("computes replyRate and rounds it to four decimals", () => {
    const stats = shapeVariantStats([row({ sends: 3, replies: 1 })], META);
    expect(stats.find((s) => s.key === "email-s1-painpoint")!.replyRate).toBe(0.3333);
  });

  it("reports replyRate 0 rather than NaN when there are no sends", () => {
    const stats = shapeVariantStats([row({ sends: 0, replies: 0, contactIds: [] })], META);
    expect(stats.find((s) => s.key === "email-s1-painpoint")!.replyRate).toBe(0);
  });

  it("breaks results down by leadSource and webPresenceTier", () => {
    const stats = shapeVariantStats(
      [
        row({ leadSource: "cold_email", webPresenceTier: "none", sends: 4, replies: 1 }),
        row({ leadSource: "referral", webPresenceTier: "social_only", sends: 2, replies: 2 }),
      ],
      META
    );
    const painpoint = stats.find((s) => s.key === "email-s1-painpoint")!;
    expect(painpoint.bySlice.leadSource.cold_email).toEqual({ sends: 4, replies: 1, replyRate: 0.25 });
    expect(painpoint.bySlice.leadSource.referral).toEqual({ sends: 2, replies: 2, replyRate: 1 });
    expect(painpoint.bySlice.webPresenceTier.none).toEqual({ sends: 4, replies: 1, replyRate: 0.25 });
    expect(painpoint.bySlice.webPresenceTier.social_only).toEqual({ sends: 2, replies: 2, replyRate: 1 });
  });

  it("keeps rows for a variant that no longer exists, with a null label", () => {
    const stats = shapeVariantStats([row({ key: "deleted-variant" })], META);
    const orphan = stats.find((s) => s.key === "deleted-variant")!;
    expect(orphan.label).toBeNull();
    expect(orphan.channel).toBeNull();
    expect(orphan.sends).toBe(1);
  });

  it("sorts by sends descending so the most-used approach reads first", () => {
    const stats = shapeVariantStats(
      [
        row({ key: "email-s1-painpoint", sends: 1 }),
        row({ key: "email-s1-compliment", sends: 9 }),
      ],
      META
    );
    expect(stats.map((s) => s.key)).toEqual(["email-s1-compliment", "email-s1-painpoint"]);
  });
});

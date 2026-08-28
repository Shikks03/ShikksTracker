/**
 * variantStats.ts — GET /api/os/variant-stats (spec §Feature C + §D.2).
 *
 * CONTRACT SURFACE (spec §D.3): consumed by ../RikuOS's retro agent. Changing
 * these shapes obliges a matching edit to ../RikuOS/ARCHITECTURE.md §4.1.
 *
 * `uniqueContacts` is present in addition to the fields listed in §D.2 because
 * §Feature C asks for it ("sends, unique contacts, replies, reply rate"). It is
 * additive, so it does not break a consumer reading only the §D.2 fields.
 */

import mongoose from "mongoose";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Variant from "@/models/Variant";

/** Bucket value used when the joined contact is missing or the field is unset. */
export const UNKNOWN_SLICE = "unknown";

/** One (variant × leadSource × webPresenceTier) aggregation row. */
export interface VariantStatsRow {
  key: string;
  leadSource: string;
  webPresenceTier: string;
  sends: number;
  replies: number;
  contactIds: string[];
}

/** The Variant metadata joined onto each result. */
export interface VariantMetaLike {
  key: string;
  label: string;
  channel: string;
  stage: number;
}

export interface SliceStats {
  sends: number;
  replies: number;
  replyRate: number;
}

export interface VariantStatsItem {
  key: string;
  label: string | null;
  channel: string | null;
  stage: number | null;
  sends: number;
  uniqueContacts: number;
  replies: number;
  replyRate: number;
  bySlice: {
    leadSource: Record<string, SliceStats>;
    webPresenceTier: Record<string, SliceStats>;
  };
}

/** Reply rate as a 4-dp fraction; 0 (not NaN) when there are no sends. */
function rate(replies: number, sends: number): number {
  if (sends === 0) return 0;
  return Math.round((replies / sends) * 10_000) / 10_000;
}

function addToSlice(
  target: Record<string, SliceStats>,
  bucket: string,
  sends: number,
  replies: number
): void {
  const current = target[bucket] ?? { sends: 0, replies: 0, replyRate: 0 };
  current.sends += sends;
  current.replies += replies;
  current.replyRate = rate(current.replies, current.sends);
  target[bucket] = current;
}

/**
 * Folds aggregation rows into the per-variant response.
 *
 * Every variant in `meta` appears even with zero rows — a seeded-but-unused
 * approach is a real signal (the rotation has not reached it yet), and omitting
 * it would look like it had been deleted. Conversely a row whose key has no
 * matching Variant still appears, with null metadata: those are logs stamped by
 * a variant that was later deleted, and silently dropping their sends would
 * overstate the reply rate of everything that remains.
 */
export function shapeVariantStats(
  rows: VariantStatsRow[],
  meta: VariantMetaLike[]
): VariantStatsItem[] {
  const metaByKey = new Map(meta.map((m) => [m.key, m]));
  const byKey = new Map<string, VariantStatsItem>();
  const contactsByKey = new Map<string, Set<string>>();

  const ensure = (key: string): VariantStatsItem => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const m = metaByKey.get(key);
    const created: VariantStatsItem = {
      key,
      label: m?.label ?? null,
      channel: m?.channel ?? null,
      stage: m?.stage ?? null,
      sends: 0,
      uniqueContacts: 0,
      replies: 0,
      replyRate: 0,
      bySlice: { leadSource: {}, webPresenceTier: {} },
    };
    byKey.set(key, created);
    contactsByKey.set(key, new Set());
    return created;
  };

  for (const m of meta) ensure(m.key);

  for (const row of rows) {
    const item = ensure(row.key);
    item.sends += row.sends;
    item.replies += row.replies;
    addToSlice(item.bySlice.leadSource, row.leadSource, row.sends, row.replies);
    addToSlice(item.bySlice.webPresenceTier, row.webPresenceTier, row.sends, row.replies);
    const seen = contactsByKey.get(row.key)!;
    for (const id of row.contactIds) seen.add(id);
  }

  for (const [key, item] of byKey) {
    item.replyRate = rate(item.replies, item.sends);
    item.uniqueContacts = contactsByKey.get(key)?.size ?? 0;
  }

  // Most-used approach first; ties break on key so the order is stable.
  return [...byKey.values()].sort(
    (a, b) => b.sends - a.sends || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/**
 * Runs the aggregation and shapes it.
 *
 * Grouping happens in Mongo down to (variant × leadSource × tier), which is a
 * handful of rows — the fold above then runs on that small set rather than on
 * every log. Only `sent` logs count: a draft nobody approved says nothing about
 * whether the approach earns replies.
 */
export async function buildOsVariantStats(): Promise<VariantStatsItem[]> {
  const rawRows = await EmailLog.aggregate<{
    _id: { key: string; leadSource: string | null; webPresenceTier: string | null };
    sends: number;
    replies: number;
    contactIds: mongoose.Types.ObjectId[];
  }>([
    { $match: { status: "sent", variantKey: { $type: "string" } } },
    {
      $lookup: {
        // $lookup.from takes a COLLECTION name, not a model name. Reading it off
        // the model means it can never drift from Mongoose's pluralisation.
        from: Contact.collection.name,
        localField: "contactId",
        foreignField: "_id",
        as: "contact",
      },
    },
    { $unwind: { path: "$contact", preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          key: "$variantKey",
          leadSource: "$contact.leadSource",
          webPresenceTier: "$contact.webPresenceTier",
        },
        sends: { $sum: 1 },
        replies: { $sum: { $cond: [{ $eq: ["$replied", true] }, 1, 0] } },
        contactIds: { $addToSet: "$contactId" },
      },
    },
  ]);

  const rows: VariantStatsRow[] = rawRows.map((r) => ({
    key: r._id.key,
    leadSource: r._id.leadSource ?? UNKNOWN_SLICE,
    webPresenceTier: r._id.webPresenceTier ?? UNKNOWN_SLICE,
    sends: r.sends,
    replies: r.replies,
    contactIds: r.contactIds.map((id) => String(id)),
  }));

  const meta = (await Variant.find({})
    .select({ key: 1, label: 1, channel: 1, stage: 1 })
    .lean()) as unknown as VariantMetaLike[];

  return shapeVariantStats(rows, meta);
}

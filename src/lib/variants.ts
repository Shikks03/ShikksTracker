/**
 * variants.ts — message-approach selection (Feature C).
 *
 * The pure selector is separated from the DB wrapper so the rotation rule can
 * be unit-tested without a live MongoDB, matching the convention every other
 * decision rule in src/lib/ follows.
 */

import mongoose from "mongoose";
import type { Types } from "mongoose";
import Variant from "@/models/Variant";
import EmailLog from "@/models/EmailLog";
import type { IVariant } from "@/models/Variant";

/** The subset of a Variant the selector reads. */
export interface SelectableVariant {
  key: string;
  active: boolean;
  channel: string;
  stage: number;
  label: string;
  promptNotes: string;
}

/**
 * Picks the least-used ACTIVE variant, or null when none is active.
 *
 * "Least used" is by the caller-supplied usage map — counts of logs already
 * stamped with each key **within the current campaign** (see
 * pickVariantForDraft). A key missing from the map counts as zero, so a brand
 * new variant is picked first.
 *
 * Ties break on `key` ascending. That matters: without a deterministic
 * tie-break the pick would depend on Mongo's returned document order, which is
 * unspecified without an explicit sort — the rotation would be untestable and
 * could silently favour one approach on a fresh campaign where every count is 0.
 */
export function selectLeastUsedVariant<T extends SelectableVariant>(
  variants: T[],
  usageByKey: Record<string, number>
): T | null {
  const active = variants.filter((v) => v.active);
  if (active.length === 0) return null;

  return active.reduce((best, candidate) => {
    const bestUses = usageByKey[best.key] ?? 0;
    const candidateUses = usageByKey[candidate.key] ?? 0;
    if (candidateUses !== bestUses) return candidateUses < bestUses ? candidate : best;
    return candidate.key < best.key ? candidate : best;
  });
}

/**
 * Loads the active variants for a channel+stage, counts how often each has
 * already been used in this campaign, and returns the one to draft with
 * (or null when no active variant matches — variantKey then stays null, which
 * is legal everywhere).
 *
 * Usage is counted per CAMPAIGN, not globally, so starting a new campaign
 * rotates approaches from scratch rather than inheriting an old campaign's
 * imbalance. Every status counts, not just "sent": a draft sitting in the review
 * queue has already consumed that approach for this contact, and counting only
 * sent logs would hand the same variant to every draft generated before the
 * first one is approved.
 */
export async function pickVariantForDraft(params: {
  channel: string;
  stage: number;
  campaignId: Types.ObjectId | string;
}): Promise<IVariant | null> {
  const variants = (await Variant.find({
    channel: params.channel as IVariant["channel"],
    stage: params.stage as IVariant["stage"],
    active: true,
  }).lean()) as unknown as IVariant[];

  if (variants.length === 0) return null;

  // NOTE: an aggregation $match does NOT apply Mongoose's schema casting, so a
  // string campaignId would match nothing and silently reset every count to
  // zero (making the rotation always pick the alphabetically-first variant).
  // Cast explicitly.
  const usageRows = await EmailLog.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        campaignId: new mongoose.Types.ObjectId(String(params.campaignId)),
        variantKey: { $in: variants.map((v) => v.key) },
      },
    },
    { $group: { _id: "$variantKey", count: { $sum: 1 } } },
  ]);

  const usageByKey: Record<string, number> = {};
  for (const row of usageRows) usageByKey[row._id] = row.count;

  return selectLeastUsedVariant(variants, usageByKey);
}

/**
 * Engagement scoring constants and helpers — Phase 7/8
 *
 * Phase 11 builds the hot-leads filter on top of engagementScore.
 */

import type { Types } from "mongoose";
import Contact from "@/models/Contact";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCORE_OPEN = 1;
export const SCORE_CLICK = 3;
export const SCORE_REPLY = 10; // used by Phase 9

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Atomically increments a contact's engagementScore by `points`.
 * Fire-and-forget friendly — the caller need not await if they don't care about
 * the return value, but awaiting is safe and returns the updated doc or null.
 */
export async function bumpEngagement(
  contactId: Types.ObjectId | string,
  points: number
): Promise<void> {
  await Contact.findByIdAndUpdate(contactId, { $inc: { engagementScore: points } });
}

/**
 * Shared reply effects — spec §A.5.
 *
 * WHY THIS EXISTS: this block used to live inline in checkReplies() (the email
 * path). P2 added a second channel that must apply exactly the same effects.
 * Two copies would drift the moment either changed, and the drift would be
 * silent — a contact still receiving follow-ups after replying looks like a
 * scheduling bug, not a missing state transition. One helper, both callers.
 *
 * Deliberately NOT covering opt-out. That path interleaves Suppression upsert
 * with log marking and alert queueing; src/lib/replies.ts documents why it
 * stays inline, and that reasoning is unchanged.
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { bumpEngagement, SCORE_REPLY } from "@/lib/scoring";
import { makeSnippet, truncateReplyBody } from "@/lib/replies";
import type { Types } from "mongoose";

export interface ReplyEffectsInput {
  contactId: Types.ObjectId | string;
  /** Which channel replied. Scopes the anchor-log lookup so a Messenger reply
   *  cannot stamp an email log, or vice versa. */
  channel: "email" | "facebook" | "instagram" | "phone";
  /** Already quote-stripped by the caller where that applies (email does;
   *  Messenger has no quoting). */
  replyText: string;
  repliedAt: Date;
  /** Pre-resolved anchor. The email path already loaded it; passing it avoids
   *  a second query and guarantees both paths stamp the same document. */
  anchorLogId?: Types.ObjectId | string | null;
}

export interface ReplyEffectsResult {
  /** false = this reply was already accounted for, so nothing was changed.
   *  The score bump is gated on this: retroactive linking replays effects for
   *  every message already stored, and +10 per message would be nonsense.
   *
   *  Two independent gates, because there are two cases:
   *    - a sent log exists  -> its `replied` flag is the gate;
   *    - no sent log exists -> the contact's own `status` is the gate. */
  applied: boolean;
  logId: string | null;
}

export async function applyReplyEffects(
  input: ReplyEffectsInput
): Promise<ReplyEffectsResult> {
  const { contactId, channel, replyText, repliedAt } = input;

  let anchor: { _id: unknown; replied?: boolean } | null = null;

  if (input.anchorLogId) {
    anchor = { _id: input.anchorLogId, replied: false };
  } else {
    anchor = (await EmailLog.findOne({
      contactId,
      status: "sent",
      channel,
    })
      .sort({ stage: -1, sentAt: -1 })
      .lean()) as { _id: unknown; replied?: boolean } | null;
  }

  // Already handled — a redelivered webhook, or a link replaying stored
  // history. Do nothing at all, including the score.
  if (anchor?.replied === true) {
    return { applied: false, logId: String(anchor._id) };
  }

  // 1. Contact leaves the cold sequence.
  if (anchor) {
    await Contact.findByIdAndUpdate(contactId, {
      status: "replied",
      pipelineStage: "replied",
      nextSendAt: null,
    });
  } else {
    // NO ANCHOR = NO IDEMPOTENCY FLAG. The gate above lives on the sent log,
    // so without one every inbound message re-applies everything: +10 each
    // time, and pipelineStage dragged back to "replied" from wherever the user
    // had since moved it (call_booked, won...). That is not an edge case on
    // Messenger — a prospect messaging the page before we ever contacted them
    // has no sent log by definition, and each of their follow-up messages
    // arrives as a separate webhook event calling straight back into here.
    //
    // So fall back to the contact's own status as the gate, and CLAIM it with
    // a conditional update rather than read-then-write: two webhook deliveries
    // can be in flight at once, and a read-then-write would let both through.
    // Verified against a live contact 2026-08-30 — before this, link/relink
    // took engagementScore 10 -> 20 and reverted call_booked -> replied.
    const claimed = await Contact.findOneAndUpdate(
      { _id: contactId, status: { $ne: "replied" } },
      { status: "replied", pipelineStage: "replied", nextSendAt: null }
    );
    if (!claimed) return { applied: false, logId: null };
  }

  // 2. Stamp the anchor, if there is one. There may not be: a prospect can
  //    message the page before we ever contacted them.
  const clean = replyText.trim();
  if (anchor) {
    await EmailLog.findByIdAndUpdate(anchor._id, {
      replied: true,
      repliedAt,
      replyBody: clean ? truncateReplyBody(clean) : null,
      replySnippet: makeSnippet(clean),
    });
  }

  // 3. Engagement.
  await bumpEngagement(contactId as Types.ObjectId, SCORE_REPLY);

  // 4. Stop queued follow-ups.
  await EmailLog.deleteMany({
    contactId,
    status: { $in: ["draft", "approved"] },
  });

  return { applied: true, logId: anchor ? String(anchor._id) : null };
}

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
  /** false = the anchor was already marked replied, so nothing was changed.
   *  The score bump is gated on this: retroactive linking replays effects for
   *  every message already stored, and +10 per message would be nonsense. */
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
  await Contact.findByIdAndUpdate(contactId, {
    status: "replied",
    pipelineStage: "replied",
    nextSendAt: null,
  });

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

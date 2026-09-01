/**
 * Echo handling — spec §A.6.
 *
 * message_echoes deliver a copy of everything the PAGE sends, including
 * messages typed by hand in the Meta inbox. When one closely matches a pending
 * facebook draft for the linked contact, mark that draft sent automatically so
 * the user does not have to come back and tap the button.
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { advanceContactAfterSend } from "@/lib/sequence";
import { tokenSimilarity, normalizedTokens } from "@/lib/messenger/similarity";
import type { Types } from "mongoose";

/** High on purpose. This is "did they paste our draft", not "is this vaguely
 *  on-topic". Below this, the manual button is the correct answer. */
export const ECHO_MATCH_THRESHOLD = 0.85;

/** Both sides must carry real content. Short messages share tokens by accident
 *  ("salamat po" vs "salamat po sa reply"), and a false positive here silently
 *  advances the pipeline. */
const MIN_TOKENS = 8;

export function isEchoMatch(echoText: string, draftBody: string): boolean {
  if (normalizedTokens(echoText).length < MIN_TOKENS) return false;
  if (normalizedTokens(draftBody).length < MIN_TOKENS) return false;
  return tokenSimilarity(echoText, draftBody) >= ECHO_MATCH_THRESHOLD;
}

function isAutoMarkEnabled(): boolean {
  return process.env.MESSENGER_ECHO_AUTOMARK !== "false";
}

/**
 * Best-effort. Returns the log id it marked, or null. Never throws — the
 * caller is inside the webhook and must still return 200.
 */
export async function maybeAutoMarkSent(
  contactId: Types.ObjectId,
  echoText: string
): Promise<string | null> {
  if (!isAutoMarkEnabled()) return null;

  const pending = await EmailLog.find({
    contactId,
    channel: "facebook",
    status: { $in: ["draft", "approved"] },
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(10)
    .lean();

  const match = pending.find((log) => isEchoMatch(echoText, log.body));
  if (!match) return null;

  // Atomic claim, exactly as the manual mark-sent route does: only the writer
  // that flips the status advances the contact, so a redelivered echo cannot
  // double-advance.
  const sentAt = new Date();
  const claimed = await EmailLog.findOneAndUpdate(
    { _id: match._id, status: { $in: ["draft", "approved"] } },
    { $set: { status: "sent", sentManuallyAt: sentAt, sentAt } },
    { new: true }
  );
  if (!claimed) return null;

  // Signature verified against src/lib/sequence.ts:379 —
  //   advanceContactAfterSend(contact: IContact, log: IEmailLog, sentAt: Date, campaign?)
  // It needs the hydrated contact, not just the log. Its own internal guard
  // (`currentStage: { $lt: log.stage }`) makes it a no-op if the contact has
  // already moved past this stage, which is a second layer of double-advance
  // protection behind the atomic claim above.
  const contact = await Contact.findById(contactId);
  if (!contact) return null;

  await advanceContactAfterSend(contact, claimed, sentAt);
  return String(claimed._id);
}

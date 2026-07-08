/**
 * Reply detection — Phase 9
 *
 * checkReplies() is called as the first step of every sequence-engine run.
 * It:
 *   1. Polls Gmail threads for replies from active contacts.
 *   2. Detects opt-out keywords in the reply body (stripping quoted text first).
 *   3. Applies state transitions (contact status, EmailLog updates, Suppression upsert).
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { getGmailClient } from "@/lib/gmail";
import { bumpEngagement, SCORE_REPLY } from "@/lib/scoring";
import type { Types } from "mongoose";

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

export interface RepliesResult {
  checked: number;
  replied: number;
  unsubscribed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Opt-out keyword detection
// ---------------------------------------------------------------------------

/**
 * Strips quoted lines (lines starting with ">") and everything from a line
 * matching "On ... wrote:" onward. This prevents false-positive opt-outs
 * from our own footer copy ("just reply STOP") appearing in the quoted block.
 *
 * Exported for unit tests only — treat as internal.
 */
export function stripQuotedText(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    // Stop at "On <date/time> ... wrote:" attribution line
    if (/^On .+ wrote:\s*$/i.test(line.trimEnd())) {
      break;
    }
    // Drop quoted lines
    if (line.trimStart().startsWith(">")) {
      continue;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * Derives a single-line snippet from cleaned reply text:
 * collapses all whitespace/newlines to single spaces, trims, truncates to
 * 80 chars with a "…" suffix if longer. Returns null when the result is empty.
 *
 * Exported for unit tests only — treat as internal.
 */
export function makeSnippet(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 80 ? collapsed.slice(0, 80) + "…" : collapsed;
}

const OPT_OUT_PATTERNS = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bopt[ -]?out\b/i,
];

/** Exported for unit tests only — treat as internal. */
export function isOptOut(text: string): boolean {
  const clean = stripQuotedText(text);
  return OPT_OUT_PATTERNS.some((re) => re.test(clean));
}

/**
 * Gmail emoji reactions (💖, 👍, …) are delivered as ordinary thread messages
 * whose From is the reacting contact — so they look exactly like replies. They
 * carry a distinctive marker: a link with `utm_campaign=emojireactionemail` and
 * the phrase "reacted via Gmail". Detect and skip them, otherwise a reaction
 * pre-empts (and masks) the real reply and wrongly flips the contact to replied.
 *
 * Exported for unit tests only — treat as internal.
 */
export function isGmailReaction(body: string): boolean {
  return (
    /utm_campaign=emojireactionemail/i.test(body) ||
    /\breacted via\s+gmail\b/i.test(body)
  );
}

// ---------------------------------------------------------------------------
// Gmail payload helpers
// ---------------------------------------------------------------------------

type GmailMessagePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailMessagePart[] | null;
};

/**
 * Recursively walks a Gmail message payload and returns the first text/plain
 * body part decoded from base64url. Falls back to null if none found.
 */
function extractPlainText(part: GmailMessagePart): string | null {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf-8");
  }
  if (part.parts) {
    for (const child of part.parts) {
      const found = extractPlainText(child);
      if (found !== null) return found;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function checkReplies(): Promise<RepliesResult> {
  const result: RepliesResult = {
    checked: 0,
    replied: 0,
    unsubscribed: 0,
    errors: [],
  };

  const gmail = getGmailClient();

  // Load all active contacts
  const contacts = await Contact.find({ status: "active" }).lean();

  for (const contact of contacts) {
    try {
      // Find the most recent sent EmailLog with a gmailThreadId for this contact
      const lastSentLog = await EmailLog.findOne({
        contactId: contact._id,
        status: "sent",
        gmailThreadId: { $ne: null },
      })
        .sort({ stage: -1, sentAt: -1 })
        .lean();

      if (!lastSentLog || !lastSentLog.gmailThreadId) {
        // Nothing sent yet — skip
        continue;
      }

      result.checked++;

      // Fetch the Gmail thread (metadata only — we only need From headers here)
      let threadData;
      try {
        const { data } = await gmail.users.threads.get({
          userId: "me",
          id: lastSentLog.gmailThreadId,
          format: "metadata",
          metadataHeaders: ["From"],
        });
        threadData = data;
      } catch (err: unknown) {
        const status = (err as { code?: number }).code;
        if (status === 404) {
          // Thread deleted / not found — ignore silently
          continue;
        }
        throw err;
      }

      const messages = threadData.messages ?? [];
      const sentAtMs = lastSentLog.sentAt ? lastSentLog.sentAt.getTime() : 0;
      const contactEmailLower = contact.contactEmail.toLowerCase();

      // Find the first GENUINE reply from the contact after our last send.
      // Gmail emoji reactions arrive as thread messages from the contact too, so
      // we fetch each candidate and skip reactions — otherwise a 👍 pre-empts and
      // masks the real reply. The fetched body is reused for opt-out detection.
      let replyMessageId: string | null = null;
      let replyInternalDateMs = 0;
      let bodyText = "";

      for (const msg of messages) {
        if (!msg.id || !msg.internalDate) continue;

        const internalDateMs = parseInt(msg.internalDate, 10);
        if (internalDateMs <= sentAtMs) continue; // not newer than our send

        // Check if From header contains the contact's email
        const fromHeader =
          msg.payload?.headers
            ?.find((h) => h.name?.toLowerCase() === "from")
            ?.value?.toLowerCase() ?? "";
        if (!fromHeader.includes(contactEmailLower)) continue;

        // Fetch the full message so we can (a) skip Gmail reactions and
        // (b) reuse the body for opt-out detection below.
        const { data: candidate } = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const candidateBody = candidate.payload
          ? extractPlainText(candidate.payload as GmailMessagePart) ??
            candidate.snippet ??
            ""
          : candidate.snippet ?? "";

        if (isGmailReaction(candidateBody)) continue; // reaction, not a reply

        replyMessageId = msg.id;
        replyInternalDateMs = internalDateMs;
        bodyText = candidateBody;
        break; // first genuine reply is enough
      }

      if (!replyMessageId) {
        // No genuine reply found for this contact
        continue;
      }

      const optOut = isOptOut(bodyText);
      const repliedAt = new Date(replyInternalDateMs);

      // ---------------------------------------------------------------------------
      // State transitions
      // ---------------------------------------------------------------------------

      if (optOut) {
        // --- Opt-out reply ---

        // 1. Update contact
        await Contact.findByIdAndUpdate(contact._id, {
          status: "unsubscribed",
          nextSendAt: null,
        });

        // 2. Upsert Suppression (tolerates pre-existing entry)
        await Suppression.updateOne(
          { email: contact.contactEmail },
          { $setOnInsert: { email: contact.contactEmail, addedAt: new Date() }, $set: { reason: "unsubscribed" } },
          { upsert: true }
        );

        // 3. Mark last sent log as replied, storing stripped body + snippet
        const optOutClean = stripQuotedText(bodyText).trim();
        await EmailLog.findByIdAndUpdate(lastSentLog._id, {
          replied: true,
          repliedAt,
          replyBody: optOutClean || null,
          replySnippet: makeSnippet(optOutClean),
        });

        // 4. Delete pending draft/approved logs for this contact
        await EmailLog.deleteMany({
          contactId: contact._id,
          status: { $in: ["draft", "approved"] },
        });

        result.unsubscribed++;
      } else {
        // --- Normal reply ---

        // 1. Update contact
        await Contact.findByIdAndUpdate(contact._id, {
          status: "replied",
          pipelineStage: "replied",
          nextSendAt: null,
        });

        // 2. Mark last sent log as replied, storing stripped body + snippet
        const replyClean = stripQuotedText(bodyText).trim();
        await EmailLog.findByIdAndUpdate(lastSentLog._id, {
          replied: true,
          repliedAt,
          replyBody: replyClean || null,
          replySnippet: makeSnippet(replyClean),
        });

        // 3. Bump engagement score
        await bumpEngagement(contact._id as Types.ObjectId, SCORE_REPLY);

        // 4. Delete pending draft/approved logs (sequence auto-stops)
        await EmailLog.deleteMany({
          contactId: contact._id,
          status: { $in: ["draft", "approved"] },
        });

        result.replied++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Contact ${String(contact._id)}: ${msg}`);
    }
  }

  return result;
}

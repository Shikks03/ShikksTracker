/**
 * Reply detection — Phases 9 + 12
 *
 * checkReplies() is called as the first step of every sequence-engine run.
 * It:
 *   1. Polls Gmail threads for replies from active contacts.
 *   2. Detects opt-out keywords in the reply body (stripping quoted text first).
 *   3. Applies state transitions (contact status, EmailLog updates, Suppression upsert).
 *   4. Queues normal-reply contacts for email-to-self takeover alerts (Phase 12).
 *   5. After ALL state transitions, sends the queued takeover alerts.
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { getGmailClient, getSenderAddress, sendGmailMessage } from "@/lib/gmail";
import { bumpEngagement, SCORE_REPLY } from "@/lib/scoring";
import { htmlEscape } from "@/lib/tracking";
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
// Internal types
// ---------------------------------------------------------------------------

interface TakeoverItem {
  contactId: Types.ObjectId;
  businessName: string;
  contactEmail: string;
  stage: number;
}

// ---------------------------------------------------------------------------
// Opt-out keyword detection
// ---------------------------------------------------------------------------

/**
 * Strips quoted lines (lines starting with ">") and everything from a line
 * matching "On ... wrote:" onward. This prevents false-positive opt-outs
 * from our own footer copy ("just reply STOP") appearing in the quoted block.
 */
function stripQuotedText(text: string): string {
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
 */
function makeSnippet(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 80 ? collapsed.slice(0, 80) + "…" : collapsed;
}

const OPT_OUT_PATTERNS = [
  /\bstop\b/i,
  /\bunsubscribe\b/i,
  /\bopt[ -]?out\b/i,
];

function isOptOut(text: string): boolean {
  const clean = stripQuotedText(text);
  return OPT_OUT_PATTERNS.some((re) => re.test(clean));
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

  // Queue of contacts with normal (non-opt-out) replies that need alerts.
  // We send alerts AFTER all state transitions to avoid interleaving.
  const takeoverQueue: TakeoverItem[] = [];

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

      // Find the first reply message from the contact after our last send
      let replyMessageId: string | null = null;
      let replyInternalDateMs = 0;

      for (const msg of messages) {
        if (!msg.id || !msg.internalDate) continue;

        const internalDateMs = parseInt(msg.internalDate, 10);
        if (internalDateMs <= sentAtMs) continue; // not newer than our send

        // Check if From header contains the contact's email
        const fromHeader =
          msg.payload?.headers
            ?.find((h) => h.name?.toLowerCase() === "from")
            ?.value?.toLowerCase() ?? "";

        if (fromHeader.includes(contactEmailLower)) {
          replyMessageId = msg.id;
          replyInternalDateMs = internalDateMs;
          break; // first qualifying reply is enough
        }
      }

      if (!replyMessageId) {
        // No reply found for this contact
        continue;
      }

      // ---------------------------------------------------------------------------
      // Fetch the reply message body (full) for opt-out detection
      // ---------------------------------------------------------------------------

      const { data: replyMsg } = await gmail.users.messages.get({
        userId: "me",
        id: replyMessageId,
        format: "full",
      });

      // Extract body text: prefer text/plain from payload, fall back to snippet
      let bodyText = "";
      if (replyMsg.payload) {
        const plain = extractPlainText(replyMsg.payload as GmailMessagePart);
        bodyText = plain ?? replyMsg.snippet ?? "";
      } else {
        bodyText = replyMsg.snippet ?? "";
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

        // 5. Queue for takeover alert (sent after all contacts processed)
        takeoverQueue.push({
          contactId: contact._id as Types.ObjectId,
          businessName: contact.businessName,
          contactEmail: contact.contactEmail,
          stage: lastSentLog.stage,
        });

        result.replied++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Contact ${String(contact._id)}: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 12: Takeover alerts — sent AFTER all state transitions
  // ---------------------------------------------------------------------------

  if (takeoverQueue.length > 0) {
    const appBaseUrl = process.env.APP_BASE_URL ?? "";
    let senderAddress: string;

    try {
      senderAddress = await getSenderAddress(gmail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Takeover alerts: could not resolve sender address: ${msg}`);
      return result;
    }

    for (const item of takeoverQueue) {
      try {
        // businessName/contactEmail originate from CSV imports — escape before
        // embedding in the alert HTML so a hostile source list can't inject markup.
        const contactUrl = encodeURI(`${appBaseUrl}/contacts/${String(item.contactId)}`);
        const htmlBody = `
<p><strong>${htmlEscape(item.businessName)}</strong> (${htmlEscape(item.contactEmail)}) replied to stage ${item.stage}.</p>
<p><a href="${contactUrl}">Open contact</a></p>
`.trim();

        await sendGmailMessage({
          to: senderAddress,
          subject: `Reply from ${item.businessName}`,
          htmlBody,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(
          `Takeover alert for contact ${String(item.contactId)}: ${msg}`
        );
      }
    }
  }

  return result;
}

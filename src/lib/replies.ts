/**
 * Reply detection — Phase 9
 *
 * checkReplies() is called as the first step of every sequence-engine run.
 * It:
 *   1. Polls Gmail threads for replies from active contacts.
 *   2. Detects opt-out keywords in the reply body (stripping quoted text first).
 *   3. Applies state transitions (contact status, EmailLog updates, Suppression upsert).
 *   4. Queues takeover alerts (for BOTH opt-outs and normal replies) and sends them last.
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { getGmailClient, sendGmailMessage, getSenderAddress } from "@/lib/gmail";
import { htmlEscape } from "@/lib/tracking";
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

/**
 * Opt-out matching design rationale (asymmetry principle):
 *
 * A false-positive opt-out is SILENT AND PERMANENT — the contact is unsubscribed,
 * a Suppression entry is created, pending drafts are deleted, and NO alert fires.
 * There is no undo for the user.
 *
 * A false-negative opt-out surfaces as a normal reply with a takeover alert — a
 * human reads it and can manually unsubscribe. The cost is one accidental follow-up
 * at most; recoverable.
 *
 * Therefore, the matcher must be STRICT. Ambiguous signals (bare "stop" mid-sentence)
 * are treated as NORMAL replies so the human takeover alert fires and a human decides.
 *
 * Tagalog opt-outs (e.g. "huwag na") are deliberately NOT matched here — a Tagalog
 * opt-out will arrive as a normal reply with a takeover alert and the human handles it.
 * TODO: evaluate adding Tagalog patterns after collecting real data in production.
 */

/**
 * Whole-message equality patterns (quote-stripped, trimmed, trailing punctuation stripped).
 * These are common single-word / short commands used as opt-out signals.
 */
const WHOLE_MESSAGE_OPT_OUTS = [
  "stop",
  "unsubscribe",
  "opt out",
  "opt-out",
];

/**
 * Intent-phrase patterns: explicit opt-out intent anywhere in the cleaned text.
 * Kept intentionally strict — no bare \bstop\b (see rationale above).
 *
 * \bunsubscribe\b and \bopt[ -]?out\b are kept because they are unambiguous in isolation
 * and are rarely used innocently in business replies.
 */
const OPT_OUT_INTENT_PATTERNS: RegExp[] = [
  // "please stop emailing/contacting/messaging me"
  /\bstop\s+(emailing|contacting|messaging)\s+me\b/i,
  // "reply stop" — opt-out instruction carried in the reply itself
  /\breply\s+stop\b/i,
  // "please remove me", "remove me from your list"
  /\bremove\s+me\b/i,
  // "please unsubscribe me", "please take me off your list"
  /\bplease\s+(remove|unsubscribe|take\s+me\s+off)\b/i,
  // "take me off your/the/this list" (optional modifier word: "mailing list", "email list", etc.)
  /\btake\s+me\s+off\s+(your|the|this)(\s+\w+)?\s+list\b/i,
  // "opt me out"
  /\bopt\s+me\s+out\b/i,
  // "do not contact me", "do not email me", "do not email me again"
  /\bdo\s+not\s+(contact|email)\s+me(\s+again)?\b/i,
  // standalone \bunsubscribe\b (unambiguous)
  /\bunsubscribe\b/i,
  // standalone \bopt[ -]?out\b (unambiguous)
  /\bopt[ -]?out\b/i,
];

/** Exported for unit tests only — treat as internal. */
export function isOptOut(text: string): boolean {
  const clean = stripQuotedText(text).trim();

  // Whole-message equality check: strip trailing punctuation (., !, ?) before comparing
  const stripped = clean.replace(/[.!?]+$/, "").trim().toLowerCase();
  if (WHOLE_MESSAGE_OPT_OUTS.includes(stripped)) return true;

  // Intent-phrase check anywhere in the cleaned text
  return OPT_OUT_INTENT_PATTERNS.some((re) => re.test(clean));
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

/**
 * Queued takeover alert (sent after all state transitions complete).
 * Alerts queue so that a failure in alert delivery can never corrupt contact state,
 * and conversely so that contact state errors can never prevent alert delivery.
 */
interface QueuedAlert {
  subject: string;
  htmlBody: string;
}

export async function checkReplies(): Promise<RepliesResult> {
  const result: RepliesResult = {
    checked: 0,
    replied: 0,
    unsubscribed: 0,
    errors: [],
  };

  // Collect alerts to send after ALL state transitions complete.
  // This ensures: (a) alert failures cannot corrupt contact state, and
  // (b) a state-transition failure on one contact cannot skip the alert for another.
  const alertQueue: QueuedAlert[] = [];

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
        //
        // NOTE: This path intentionally does NOT call suppressContact() from
        // src/lib/contacts.ts because this flow interleaves Suppression upsert,
        // EmailLog marking, and alert queueing in a way that makes refactoring
        // to a shared helper more risky than helpful. The shared helper handles
        // the manual-PATCH path (Task 3.4). Structural equivalent is preserved.

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

        // 5. Queue takeover alert for opt-out — sent last so alert failure cannot
        //    corrupt state above, and so the user can audit for matcher misfires.
        //    Subject uses "Opt-out from" to distinguish from normal-reply alerts.
        const escapedName = htmlEscape(contact.businessName);
        const escapedEmail = htmlEscape(contact.contactEmail);
        const escapedSnippet = optOutClean ? htmlEscape(makeSnippet(optOutClean) ?? "") : "";
        const optOutBaseUrl = process.env.APP_BASE_URL;
        const optOutDashboardLink = optOutBaseUrl
          ? `\n            <p><a href="${encodeURI(`${optOutBaseUrl}/contacts/${contact._id}`)}">Open contact in dashboard</a></p>`
          : "";
        alertQueue.push({
          subject: `Opt-out from ${contact.businessName}`,
          htmlBody: `
            <h2>Opt-out detected — ${escapedName}</h2>
            <p><strong>Email:</strong> ${escapedEmail}</p>
            <p><strong>Message snippet:</strong> ${escapedSnippet || "(empty)"}</p>
            <p>The contact has been unsubscribed and added to the suppression list.
               If this looks like a false positive (e.g. the phrase was not a real opt-out),
               you can manually re-activate the contact and remove the suppression entry
               from the dashboard.</p>${optOutDashboardLink}
          `.trim(),
        });
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

        // 5. Queue takeover alert for normal reply — sent last so alert failure
        //    cannot corrupt state above.
        const escapedName = htmlEscape(contact.businessName);
        const escapedEmail = htmlEscape(contact.contactEmail);
        const escapedSnippet = replyClean ? htmlEscape(makeSnippet(replyClean) ?? "") : "";
        const replyBaseUrl = process.env.APP_BASE_URL;
        const replyDashboardLink = replyBaseUrl
          ? `\n            <p><a href="${encodeURI(`${replyBaseUrl}/contacts/${contact._id}`)}">Open contact in dashboard</a></p>`
          : "";
        alertQueue.push({
          subject: `Reply from ${contact.businessName}`,
          htmlBody: `
            <h2>New reply — ${escapedName}</h2>
            <p><strong>Email:</strong> ${escapedEmail}</p>
            <p><strong>Message snippet:</strong> ${escapedSnippet || "(no preview available)"}</p>
            <p>Log in to the dashboard to view the full thread and move this lead forward.</p>${replyDashboardLink}
          `.trim(),
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Contact ${String(contact._id)}: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Send all queued alerts — AFTER all state transitions complete.
  // Each alert is sent in its own try/catch so one failure cannot suppress others.
  // ---------------------------------------------------------------------------

  if (alertQueue.length > 0) {
    let selfAddress: string | null = null;
    try {
      selfAddress = await getSenderAddress(gmail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Alert: could not resolve sender address — ${msg}`);
    }

    if (selfAddress) {
      for (const alert of alertQueue) {
        try {
          await sendGmailMessage({
            to: selfAddress,
            subject: alert.subject,
            htmlBody: alert.htmlBody,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`Alert "${alert.subject}": ${msg}`);
        }
      }
    }
  }

  return result;
}

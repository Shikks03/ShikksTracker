/**
 * Sequence engine — Phase 6
 *
 * Flow per cron run:
 *   A. checkReplies()   — stub, Phase 9 slots in here
 *   B. generateDrafts() — create EmailLog {status:"draft"} for due contacts
 *   C. sendApproved()   — send EmailLogs {status:"approved"}, advance contact state
 */

import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import Campaign from "@/models/Campaign";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { generateEmailDraft } from "@/lib/draft";
import { extractAndRewriteLinks, renderTrackedHtml } from "@/lib/tracking";
import {
  sendGmailMessage,
  getGmailClient,
} from "@/lib/gmail";
import type { IEmailLog } from "@/models/EmailLog";
import type { IContact } from "@/models/Contact";
import type { ICampaign } from "@/models/Campaign";
import { randomUUID } from "crypto";
import type { Types } from "mongoose";
import { checkReplies } from "@/lib/replies";
import { applyPlaceholders } from "@/lib/compose";
import { suppressContact } from "@/lib/contacts";

// ---------------------------------------------------------------------------
// Config constants (env-overridable, sane defaults)
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DAILY_SEND_CAP = envInt("DAILY_SEND_CAP", 15);
/**
 * Max sends per cron invocation. Default is 1 for Vercel Hobby safety: with no
 * inter-send sleep in the cron path, the function completes well within the
 * Hobby 60 s limit even if it is enforced. The hourly pinger (8–18h Manila,
 * 10 runs/day) spreads throughput; the 15/day cap remains reachable across
 * window hours plus manual send-batch. Raise this only on a plan that guarantees
 * longer function durations (e.g. Vercel Pro with maxDuration > 60 s).
 */
const SENDS_PER_RUN = envInt("SENDS_PER_RUN", 1);
const DRAFTS_PER_RUN = envInt("DRAFTS_PER_RUN", 10);
const SEND_WINDOW_START_HOUR = 8;
const SEND_WINDOW_END_HOUR = 18;
const SEND_WINDOW_TIMEZONE = "Asia/Manila";
/**
 * Stop starting new sends when elapsed run time exceeds this (Vercel function limit safety).
 * With SENDS_PER_RUN=1 and no inter-send sleep, a single-send run typically completes in
 * a few seconds, so this budget is a belt-and-suspenders guard for unusually slow sends.
 */
const RUN_TIME_BUDGET_MS = 240_000;

// ---------------------------------------------------------------------------
// Stale-send sweep constants
// ---------------------------------------------------------------------------

/**
 * A log that has been in "sending" for longer than this is considered stale
 * (process likely died after Gmail returned but before the DB update completed,
 * OR the Gmail call itself timed out). Stale logs are reverted to "draft" so
 * a human can re-approve after verifying in the Gmail Sent folder.
 *
 * 10 minutes is intentionally conservative: a normal send + post-send DB writes
 * completes in a few seconds, so there is a large safety margin before a log
 * is treated as stale and reverted to "draft" for human review.
 */
const STALE_SENDING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Bounce detection — send-time classifier
// ---------------------------------------------------------------------------

/**
 * GaxiosError shape (googleapis wraps all HTTP errors in this).
 * Only the fields we inspect are declared here; the actual type has more.
 */
interface GaxiosErrorLike {
  code?: number | string;
  status?: number | string;
  errors?: Array<{ domain?: string; reason?: string; message?: string }>;
  message?: string;
}

/**
 * Returns true when a Gmail API send error is unambiguously caused by an
 * invalid / non-existent recipient address — i.e. a hard bounce.
 *
 * Conservative by design: when in doubt, returns false so the normal
 * revert-to-approved retry path is taken. Only CLEAR invalid-recipient
 * signals are classified as bounces.
 *
 * Signals checked:
 *  - HTTP 400 + reason "invalidArgument" + message contains address/recipient
 *    keywords (the Gmail API returns this for bad recipient addresses).
 *  - HTTP 404 + reason "notFound" + message contains address/recipient keywords
 *    (occasionally seen for deleted/non-existent Gmail accounts).
 *
 * Quota (429), auth (401/403), transient 5xx → returns false (not a bounce).
 *
 * Exported for unit tests — treat as internal.
 */
export function isInvalidRecipientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as GaxiosErrorLike;

  // Normalise HTTP status to a number
  const status =
    typeof e.code === "number"
      ? e.code
      : typeof e.status === "number"
      ? e.status
      : typeof e.code === "string"
      ? parseInt(e.code, 10)
      : typeof e.status === "string"
      ? parseInt(e.status as string, 10)
      : NaN;

  // Only 400 and 404 are plausible invalid-recipient statuses.
  // Everything else (429 quota, 401/403 auth, 5xx transient) is NOT a bounce.
  if (status !== 400 && status !== 404) return false;

  // Look for invalidArgument or notFound reason in the nested errors array
  const reasons = (e.errors ?? []).map((x) => (x.reason ?? "").toLowerCase());
  const hasInvalidArgument = reasons.includes("invalidargument");
  const hasNotFound = reasons.includes("notfound");

  if (!hasInvalidArgument && !hasNotFound) return false;

  // Require the error message to mention address/recipient to avoid
  // mis-classifying other 400/404 reasons (e.g. bad threadId) as bounces.
  const msg = (e.message ?? "").toLowerCase();
  const RECIPIENT_KEYWORDS = [
    "recipient",
    "address",
    "invalid to",
    "invalid email",
    "no such user",
    "user not found",
    "does not exist",
    "mailbox not found",
  ];
  return RECIPIENT_KEYWORDS.some((kw) => msg.includes(kw));
}

// ---------------------------------------------------------------------------
// Exported pure helpers (unit-testable, no DB)
// ---------------------------------------------------------------------------

/**
 * Returns true when a log in "sending" state should be treated as stale.
 *
 * A log is stale when sendAttemptedAt is non-null and the elapsed time
 * since the claim exceeds STALE_SENDING_THRESHOLD_MS.
 *
 * Exported for unit tests — treat as internal.
 */
export function isStaleSending(
  sendAttemptedAt: Date | null,
  now: Date
): boolean {
  if (!sendAttemptedAt) return false;
  return now.getTime() - sendAttemptedAt.getTime() > STALE_SENDING_THRESHOLD_MS;
}

/**
 * Returns the local hour (0-23) in Manila time for a given UTC Date.
 *
 * Example: 2026-07-04T01:30:00Z → 9
 * (UTC+8 → 01:30 + 8h = 09:30 → hour 9)
 */
export function getManilaHour(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SEND_WINDOW_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) throw new Error("getManilaHour: no hour part returned by Intl");
  // Intl hour12:false returns "24" for midnight in some engines; normalise.
  const h = parseInt(hourPart.value, 10);
  return h === 24 ? 0 : h;
}

/**
 * Returns true when date falls inside the send window [start, end).
 */
export function isWithinSendWindow(date: Date): boolean {
  const hour = getManilaHour(date);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

/**
 * Returns the UTC Date representing midnight Manila time on the same Manila calendar
 * day as `date`. Manila is fixed UTC+8 (no DST), so we exploit that.
 *
 * Example: 2026-07-04T01:30:00Z is 2026-07-04 09:30 Manila → Manila midnight = 2026-07-03T16:00:00Z
 */
export function getManilaDayStart(date: Date): Date {
  // Manila is UTC+8 — midnight Manila = UTC midnight - 8h
  const manilaOffsetMs = 8 * 60 * 60 * 1000;
  // Shift the date to "Manila civil time" expressed as a UTC value
  const manilaMs = date.getTime() + manilaOffsetMs;
  // Floor to start of day
  const dayStartMs = Math.floor(manilaMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
  // Convert back to UTC
  return new Date(dayStartMs - manilaOffsetMs);
}

/**
 * Computes nextSendAt for a given stage.
 *
 * sequenceSpacingDays are days-from-first-send (index 0 = stage 1, etc.).
 * nextSendAt for stage N = firstSentAt + spacingDays[N-1] days.
 *
 * Example: computeNextSendAt(2026-07-01, [0,5,9], 2) → 2026-07-06
 * (firstSentAt + spacingDays[1] = +5 days)
 */
export function computeNextSendAt(
  firstSentAt: Date,
  spacingDays: number[],
  nextStage: 2 | 3
): Date {
  const days = spacingDays[nextStage - 1] ?? (nextStage === 2 ? 5 : 9);
  return new Date(firstSentAt.getTime() + days * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Internal: fetch RFC-2822 Message-ID header from Gmail after send
// ---------------------------------------------------------------------------

async function fetchRfcMessageId(gmailMessageId: string): Promise<string | null> {
  try {
    const gmail = getGmailClient();
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID"],
    });
    const header = data.payload?.headers?.find(
      (h) => h.name?.toLowerCase() === "message-id"
    );
    return header?.value ?? null;
  } catch (err) {
    console.warn(`[sequence] fetchRfcMessageId failed for ${gmailMessageId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suppression check helper (delegates to suppressContact in contacts.ts)
// ---------------------------------------------------------------------------

/**
 * Applies the "suppressed contact" transition for a contact whose email appears
 * in the Suppression list:
 *   - Sets contact status to "unsubscribed" and clears nextSendAt.
 *   - Deletes all pending draft/approved logs for the contact.
 *
 * NOTE: This does NOT delete a log that is currently in "sending" state.
 * The caller (sendOneLog) is responsible for resolving that log separately
 * before returning, since it was already claimed with status "sending".
 *
 * Delegates to suppressContact() in src/lib/contacts.ts with
 * upsertSuppression: false — the Suppression entry already exists (that's how
 * we discovered the contact needed suppressing), so we do not re-upsert it.
 * This is semantically identical to the previous inline implementation.
 *
 * Does NOT fire a takeover alert (a suppression check is not a reply; the
 * entry was created by a human or the opt-out path).
 */
async function applySuppressionTransition(contactId: Types.ObjectId): Promise<void> {
  await suppressContact(contactId, "unsubscribed", { upsertSuppression: false });
}

// ---------------------------------------------------------------------------
// Phase B: generateDrafts
// ---------------------------------------------------------------------------

interface DraftsResult {
  created: number;
  errors: string[];
}

async function generateDrafts(): Promise<DraftsResult> {
  const now = new Date();
  const result: DraftsResult = { created: 0, errors: [] };

  const contacts = await Contact.find({
    status: "active",
    nextSendAt: { $lte: now, $ne: null },
    currentStage: { $lt: 3 },
  })
    .sort({ nextSendAt: 1 })
    .lean();

  for (const contact of contacts) {
    if (result.created >= DRAFTS_PER_RUN) break;

    try {
      const targetStage = (contact.currentStage + 1) as 1 | 2 | 3;

      // Idempotency: skip if a log already exists for this contact+stage.
      // "sending" is included: a log currently mid-send must not be replaced.
      const existing = await EmailLog.findOne({
        contactId: contact._id,
        stage: targetStage,
        status: { $in: ["draft", "approved", "sending", "sent"] },
      }).lean();

      if (existing) continue;

      // Suppression check — before the Claude API call so we don't waste tokens
      // on a contact that has been manually suppressed since the query ran.
      // Email equality is safe: both Contact.contactEmail and Suppression.email
      // are stored lowercase-normalised (lowercase: true in both schemas).
      const suppressed = await Suppression.findOne({
        email: contact.contactEmail,
      }).lean();
      if (suppressed) {
        await applySuppressionTransition(contact._id);
        result.errors.push(
          `Contact ${String(contact._id)} (${contact.contactEmail}): suppressed — unsubscribed, pending logs deleted, skipped draft`
        );
        continue;
      }

      // Load campaign
      const campaign = await Campaign.findById(contact.campaignId).lean() as ICampaign | null;
      if (!campaign) {
        result.errors.push(
          `Contact ${String(contact._id)}: campaign ${String(contact.campaignId)} not found`
        );
        continue;
      }

      // Gather previous sent logs for continuity context
      const previousLogs = await EmailLog.find({
        contactId: contact._id,
        stage: { $lt: targetStage },
        status: "sent",
      })
        .sort({ stage: 1 })
        .select({ subject: 1, body: 1 })
        .lean();

      const previousEmails = previousLogs.map((l) => ({
        subject: l.subject,
        body: l.body,
      }));

      // Generate draft via Claude
      const draft = await generateEmailDraft({
        offerSummary: campaign.offerSummary,
        toneNotes: campaign.toneNotes,
        businessName: contact.businessName,
        contactName: contact.contactName,
        keyPoints: contact.keyPoints,
        stage: targetStage,
        previousEmails: previousEmails.length ? previousEmails : undefined,
      });

      // Persist as draft
      await EmailLog.create({
        contactId: contact._id,
        campaignId: contact.campaignId,
        stage: targetStage,
        status: "draft",
        subject: draft.subject,
        body: draft.body,
      });

      result.created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Contact ${String(contact._id)}: ${msg}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Exported: send a single approved EmailLog
// ---------------------------------------------------------------------------

export interface SendOneLogResult {
  status: "sent" | "skipped" | "failed";
  contactName: string;
  subject: string;
  error?: string;
}

/**
 * Sends one approved EmailLog. Handles threading, tracking, Gmail send,
 * post-send EmailLog/Contact updates. Called by both the sequence engine
 * and the manual send-batch API.
 *
 * Idempotency: atomically claims the log by transitioning it from "approved"
 * to "sending" before touching Gmail. If the claim fails (another runner
 * already claimed it, or the log is no longer "approved"), returns "skipped".
 *
 * Failure paths:
 *   - Contact inactive or missing  → revert to "draft" (won't re-appear in send queue)
 *   - Campaign missing             → revert to "draft"
 *   - Gmail send failure           → revert to "approved" + record error fields
 *                                    (email never left; safe to auto-retry)
 *   - Post-send failure (rfcMessageId fetch, DB updates after Gmail succeeded)
 *                                  → revert to "draft" + record error fields
 *                                    (email WAS sent; do NOT auto-retry — human must verify
 *                                     in Gmail Sent folder before re-approving)
 *   - Gmail success                → update to "sent" with all tracking fields
 *
 * No code path may leave the log stuck in "sending" — every branch resolves the state.
 */
export async function sendOneLog(log: IEmailLog): Promise<SendOneLogResult> {
  // --- Atomic claim: approved → sending ---
  // findOneAndUpdate with status precondition ensures only one runner claims this log.
  const now = new Date();
  const claimed = await EmailLog.findOneAndUpdate(
    { _id: log._id, status: "approved" },
    { status: "sending", sendAttemptedAt: now },
    { new: false } // we don't need the updated doc
  );
  if (!claimed) {
    // Another runner claimed it, or it was already sent/draft/sending
    return {
      status: "skipped",
      contactName: "unknown",
      subject: log.subject,
      error: "log no longer approved — skipped (race condition or already claimed)",
    };
  }

  // From here on the log is "sending" in the DB. Every exit path MUST resolve the state.

  // Tracks whether Gmail accepted the message. Declared outside the try so the outer
  // catch can distinguish pre-send failures (safe to auto-retry) from post-send failures
  // (email already delivered — human must verify before re-approving).
  let gmailSendSucceeded = false;

  try {
    // Load contact
    const contact = await Contact.findById(log.contactId).lean() as IContact | null;
    if (!contact || contact.status !== "active") {
      // Revert to draft — contact is gone or inactive; no point retrying
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft", sendAttemptedAt: null });
      return {
        status: "skipped",
        contactName: contact?.businessName ?? "unknown",
        subject: log.subject,
        error: "contact not active — reverted to draft",
      };
    }

    // Suppression check — after contact load, before Gmail/Claude work.
    // A contact may have been manually added to the suppression list after their
    // logs were approved; we must honour this before sending (SPEC §14, PH DPA).
    // Email equality is safe: both Contact.contactEmail and Suppression.email are
    // stored lowercase-normalised (lowercase: true in both schemas).
    const suppressed = await Suppression.findOne({
      email: contact.contactEmail,
    }).lean();
    if (suppressed) {
      // Apply contact transition (status → unsubscribed, nextSendAt → null,
      // delete draft/approved logs). The current log is in "sending" and is NOT
      // covered by the deleteMany (which only touches draft/approved), so we
      // delete it explicitly — it must never send.
      await applySuppressionTransition(contact._id);
      await EmailLog.findByIdAndDelete(log._id);
      return {
        status: "skipped",
        contactName: contact.businessName,
        subject: log.subject,
        error: "contact email is suppressed — unsubscribed, log deleted",
      };
    }

    // Load campaign (needed for sequenceSpacingDays)
    const campaign = await Campaign.findById(log.campaignId).lean() as ICampaign | null;
    if (!campaign) {
      // Revert to draft — campaign is gone; no point retrying
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft", sendAttemptedAt: null });
      return {
        status: "skipped",
        contactName: contact.businessName,
        subject: log.subject,
        error: "campaign not found — reverted to draft",
      };
    }

    // Threading for stages 2–3
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;
    let subjectToSend = log.subject;

    if (log.stage > 1) {
      const prevLog = await EmailLog.findOne({
        contactId: contact._id,
        stage: { $lt: log.stage },
        status: "sent",
      })
        .sort({ stage: -1 })
        .lean();

      if (prevLog) {
        if (prevLog.gmailThreadId) threadId = prevLog.gmailThreadId;
        if (prevLog.rfcMessageId) inReplyTo = prevLog.rfcMessageId;

        // Build References oldest-first (RFC 5322): stage-1 first, then prevLog
        let stage1RfcMessageId: string | null | undefined;
        if (log.stage === 3) {
          const stage1Log = await EmailLog.findOne({
            contactId: contact._id,
            stage: 1,
            status: "sent",
          }).lean();
          stage1RfcMessageId = stage1Log?.rfcMessageId;
        }
        const refParts = [stage1RfcMessageId, prevLog.rfcMessageId];
        const uniqueRefs = [...new Set(refParts.filter(Boolean))];
        if (uniqueRefs.length) references = uniqueRefs.join(" ");

        subjectToSend = prevLog.subject.startsWith("Re:")
          ? prevLog.subject
          : `Re: ${prevLog.subject}`;

        log.subject = subjectToSend;
        await EmailLog.findByIdAndUpdate(log._id, { subject: subjectToSend });
      }
    }

    // Placeholder substitution at send time — case-insensitive and
    // path-independent (fills {{businessName}}/{{contactName}} regardless of
    // how the log was created: batch compose, single compose, or AI draft).
    subjectToSend = applyPlaceholders(subjectToSend, contact);
    const bodyToSend = applyPlaceholders(log.body, contact);

    // Tracking IDs (not persisted until post-send update so failed sends retry cleanly)
    const trackingPixelId = randomUUID();
    const { links } = extractAndRewriteLinks(bodyToSend);
    const htmlBody = renderTrackedHtml(bodyToSend, links, trackingPixelId);

    // Send — if this throws, we catch below and revert to "approved"
    let messageId: string;
    let returnedThreadId: string;
    try {
      const sendResult = await sendGmailMessage({
        to: contact.contactEmail,
        subject: subjectToSend,
        htmlBody,
        threadId,
        inReplyTo,
        references,
      });
      messageId = sendResult.messageId;
      returnedThreadId = sendResult.threadId;
      gmailSendSucceeded = true;
    } catch (gmailErr) {
      const errMsg = gmailErr instanceof Error ? gmailErr.message : String(gmailErr);

      // --- Bounce detection (send-time) ---
      // If the error is unambiguously an invalid recipient, treat as a hard bounce:
      //   1. Suppress the contact (status → "bounced", nextSendAt → null, draft/approved logs deleted).
      //   2. Delete the current log (it's in "sending" and must never send).
      //   3. Return "skipped" — the contact is now inert; no retry needed.
      // All other Gmail errors → revert to "approved" for normal auto-retry.
      if (isInvalidRecipientError(gmailErr)) {
        // Hard bounce — suppress the contact (status → "bounced", pending
        // draft/approved logs deleted, Suppression entry upserted), then
        // delete the current log (it is in "sending" and must never send;
        // suppressContact only deletes draft/approved, not sending logs).
        const bounceMsg = `bounced: ${errMsg}`;
        await suppressContact(contact._id, "bounced");
        await EmailLog.findByIdAndDelete(log._id);
        return {
          status: "skipped",
          contactName: contact.businessName,
          subject: subjectToSend,
          error: bounceMsg,
        };
      }

      // Gmail failed for a non-bounce reason — revert to "approved" so the user can retry
      await EmailLog.findByIdAndUpdate(log._id, {
        status: "approved",
        sendAttemptedAt: null,
        $inc: { sendErrorCount: 1 },
        lastSendError: errMsg,
      });
      return {
        status: "failed",
        contactName: contact.businessName,
        subject: subjectToSend,
        error: errMsg,
      };
    }

    const sentAt = new Date();
    const rfcMessageId = await fetchRfcMessageId(messageId);

    // Update EmailLog — persist the substituted subject/body so the sent
    // record is an accurate audit trail of what actually went out.
    // lastSendError: null clears any stale error from a prior failed attempt.
    await EmailLog.findByIdAndUpdate(log._id, {
      status: "sent",
      sentAt,
      subject: subjectToSend,
      body: bodyToSend,
      gmailMessageId: messageId,
      gmailThreadId: returnedThreadId,
      rfcMessageId,
      trackingPixelId,
      links,
      lastSendError: null,
    });

    // Update Contact
    const contactUpdate: Record<string, unknown> = {
      currentStage: log.stage,
    };
    if (log.stage === 1 && contact.pipelineStage === "not_started") {
      contactUpdate.pipelineStage = "contacted";
    }

    let firstSentAt: Date;
    if (log.stage === 1) {
      firstSentAt = sentAt;
    } else {
      const stage1Log = await EmailLog.findOne({
        contactId: contact._id,
        stage: 1,
        status: "sent",
      })
        .select({ sentAt: 1 })
        .lean();
      firstSentAt = stage1Log?.sentAt ?? sentAt;
    }

    if (log.stage < 3) {
      contactUpdate.nextSendAt = computeNextSendAt(
        firstSentAt,
        campaign.sequenceSpacingDays,
        (log.stage + 1) as 2 | 3
      );
    } else {
      contactUpdate.nextSendAt = null;
    }

    await Contact.findByIdAndUpdate(contact._id, contactUpdate);

    return { status: "sent", contactName: contact.businessName, subject: subjectToSend };
  } catch (err) {
    // Unexpected error after claim. Branch on whether Gmail already accepted the message:
    //   - Pre-send failure  (gmailSendSucceeded === false): email never left; revert to
    //     "approved" so the next cron run retries automatically.
    //   - Post-send failure (gmailSendSucceeded === true):  email was delivered but state
    //     recording failed. Revert to "draft" — NOT "approved" — so it does NOT auto-retry.
    //     A human must verify in the Gmail Sent folder before re-approving.
    const msg = err instanceof Error ? err.message : String(err);
    if (gmailSendSucceeded) {
      // Email went out but post-send DB/fetch work failed. Human review required.
      await EmailLog.findByIdAndUpdate(log._id, {
        status: "draft",
        sendAttemptedAt: null,
        $inc: { sendErrorCount: 1 },
        lastSendError: `interrupted after Gmail send — email was sent but state update failed; verify in Gmail Sent folder before re-approving`,
      }).catch(() => {
        console.error(`[sequence] CRITICAL: failed to revert log ${String(log._id)} from "sending" to "draft" after post-send failure:`, msg);
      });
    } else {
      // Pre-send failure — email never left; safe to auto-retry.
      await EmailLog.findByIdAndUpdate(log._id, {
        status: "approved",
        sendAttemptedAt: null,
        $inc: { sendErrorCount: 1 },
        lastSendError: `unexpected error: ${msg}`,
      }).catch(() => {
        // Best-effort revert — if this also fails, the stale-send sweep will catch it
        console.error(`[sequence] CRITICAL: failed to revert log ${String(log._id)} from "sending" to "approved":`, msg);
      });
    }
    return { status: "failed", contactName: "unknown", subject: log.subject, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Phase C: sendApproved
// ---------------------------------------------------------------------------

interface SendsResult {
  sent: number;
  skipped: string[];
  errors: string[];
}

async function sendApproved(runStartMs: number): Promise<SendsResult> {
  const result: SendsResult = { sent: 0, skipped: [], errors: [] };
  const now = new Date();

  if (!isWithinSendWindow(now)) {
    result.skipped.push("outside send window");
    return result;
  }

  const dayStart = getManilaDayStart(now);
  const sentToday = await EmailLog.countDocuments({
    status: "sent",
    sentAt: { $gte: dayStart },
  });
  const remaining = DAILY_SEND_CAP - sentToday;
  if (remaining <= 0) {
    result.skipped.push("daily cap reached");
    return result;
  }

  const batchLimit = Math.min(remaining, SENDS_PER_RUN);

  const approvedLogs = await EmailLog.find({ status: "approved" })
    .sort({ _id: 1 })
    .limit(batchLimit);

  for (let i = 0; i < approvedLogs.length; i++) {
    const log = approvedLogs[i];

    if (Date.now() - runStartMs > RUN_TIME_BUDGET_MS) {
      result.skipped.push(`time budget exceeded — ${approvedLogs.length - i} log(s) deferred`);
      break;
    }

    const logResult = await sendOneLog(log);
    if (logResult.status === "sent") {
      result.sent++;
    } else if (logResult.status === "skipped") {
      result.skipped.push(`log ${String(log._id)}: ${logResult.error ?? "skipped"}`);
    } else {
      result.errors.push(`log ${String(log._id)}: ${logResult.error ?? "failed"}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run summary type
// ---------------------------------------------------------------------------

export interface RunSummary {
  staleSendingReverted: number;
  repliesChecked: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
  draftsCreated: number;
  sent: number;
  skipped: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Stale-send sweep
// ---------------------------------------------------------------------------

interface StaleSweepResult {
  reverted: number;
}

/**
 * Finds logs stuck in "sending" for longer than STALE_SENDING_THRESHOLD_MS
 * and reverts them to "draft" so a human can re-approve after verifying
 * in the Gmail Sent folder. Does NOT auto-revert to "approved" — the send
 * may or may not have succeeded, so human review is required.
 */
async function sweepStaleSendingLogs(): Promise<StaleSweepResult> {
  const cutoff = new Date(Date.now() - STALE_SENDING_THRESHOLD_MS);
  const res = await EmailLog.updateMany(
    {
      status: "sending",
      sendAttemptedAt: { $lte: cutoff },
    },
    {
      status: "draft",
      sendAttemptedAt: null,
      lastSendError: "interrupted mid-send — verify in Gmail Sent folder before re-approving",
    }
  );
  return { reverted: res.modifiedCount };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSequenceEngine(): Promise<RunSummary> {
  const runStartMs = Date.now();

  await connectDB();

  // 0: Sweep stale "sending" logs before anything else — clears ambiguous state
  //    from a previous run that was killed after the Gmail call but before the DB update.
  const sweepResult = await sweepStaleSendingLogs();

  // A: Check replies (Phase 9 stub)
  const repliesResult = await checkReplies();

  // B: Generate drafts
  const draftsResult = await generateDrafts();

  // C: Send approved
  const sendsResult = await sendApproved(runStartMs);

  return {
    staleSendingReverted: sweepResult.reverted,
    repliesChecked: repliesResult.checked,
    replied: repliesResult.replied,
    unsubscribed: repliesResult.unsubscribed,
    bounced: repliesResult.bounced,
    draftsCreated: draftsResult.created,
    sent: sendsResult.sent,
    skipped: sendsResult.skipped,
    errors: [...repliesResult.errors, ...draftsResult.errors, ...sendsResult.errors],
  };
}

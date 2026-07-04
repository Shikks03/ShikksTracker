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
import { generateEmailDraft, bodyToHtml } from "@/lib/draft";
import {
  sendGmailMessage,
  getGmailClient,
  sleep,
  randomDelayMs,
} from "@/lib/gmail";
import type { IEmailLog } from "@/models/EmailLog";
import type { IContact } from "@/models/Contact";
import type { ICampaign } from "@/models/Campaign";

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
const SENDS_PER_RUN = envInt("SENDS_PER_RUN", 3);
const DRAFTS_PER_RUN = envInt("DRAFTS_PER_RUN", 10);
const SEND_DELAY_MIN_MS = envInt("SEND_DELAY_MIN_MS", 30_000);
const SEND_DELAY_MAX_MS = envInt("SEND_DELAY_MAX_MS", 60_000);
const SEND_WINDOW_START_HOUR = 8;
const SEND_WINDOW_END_HOUR = 18;
const SEND_WINDOW_TIMEZONE = "Asia/Manila";
/** Stop starting new sends when elapsed run time exceeds this (Vercel function limit safety). */
const RUN_TIME_BUDGET_MS = 240_000;

// ---------------------------------------------------------------------------
// Exported pure helpers (unit-testable, no DB)
// ---------------------------------------------------------------------------

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
// Internal: render email HTML (stub for Phase 7 pixel + Phase 8 link rewriting)
// ---------------------------------------------------------------------------

/**
 * Converts an EmailLog's body to HTML for sending.
 *
 * TODO Phase 7: inject tracking pixel.
 * TODO Phase 8: rewrite links with tracking wrappers.
 */
function renderEmailHtml(log: IEmailLog): string {
  return bodyToHtml(log.body);
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
// Phase A: checkReplies (stub — Phase 9 slots in here)
// ---------------------------------------------------------------------------

interface RepliesResult {
  checked: number;
}

// TODO Phase 9: implement reply detection via Gmail API history/search.
async function checkReplies(): Promise<RepliesResult> {
  return { checked: 0 };
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

      // Idempotency: skip if a log already exists for this contact+stage
      const existing = await EmailLog.findOne({
        contactId: contact._id,
        stage: targetStage,
        status: { $in: ["draft", "approved", "sent"] },
      }).lean();

      if (existing) continue;

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

  // Guard: send window
  if (!isWithinSendWindow(now)) {
    result.skipped.push("outside send window");
    return result;
  }

  // Guard: daily cap
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
    .sort({ _id: 1 }) // oldest first
    .limit(batchLimit);

  for (let i = 0; i < approvedLogs.length; i++) {
    const log = approvedLogs[i];

    // Time-budget check
    if (Date.now() - runStartMs > RUN_TIME_BUDGET_MS) {
      result.skipped.push(`time budget exceeded — ${approvedLogs.length - i} log(s) deferred`);
      break;
    }

    try {
      // Load contact
      const contact = await Contact.findById(log.contactId).lean() as IContact | null;

      if (!contact || contact.status !== "active") {
        await EmailLog.findByIdAndUpdate(log._id, { status: "draft" });
        result.skipped.push(`log ${String(log._id)}: contact not active — reverted to draft`);
        continue;
      }

      // Load campaign (needed for sequenceSpacingDays)
      const campaign = await Campaign.findById(log.campaignId).lean() as ICampaign | null;
      if (!campaign) {
        await EmailLog.findByIdAndUpdate(log._id, { status: "draft" });
        result.skipped.push(`log ${String(log._id)}: campaign not found — reverted to draft`);
        continue;
      }

      // Threading for stages 2–3
      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;
      let subjectToSend = log.subject;

      if (log.stage > 1) {
        // Find most recent sent log with stage < this stage
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

          // Subject override: keep Gmail threading reliable
          const prevSubject = prevLog.subject;
          if (!prevSubject.startsWith("Re:")) {
            subjectToSend = `Re: ${prevSubject}`;
          } else {
            subjectToSend = prevSubject;
          }

          // Persist the actual subject that will be sent
          log.subject = subjectToSend;
          await EmailLog.findByIdAndUpdate(log._id, { subject: subjectToSend });
        }
      }

      const htmlBody = renderEmailHtml(log);

      // Send
      const { messageId, threadId: returnedThreadId } = await sendGmailMessage({
        to: contact.contactEmail,
        subject: subjectToSend,
        htmlBody,
        threadId,
        inReplyTo,
        references,
      });

      const sentAt = new Date();

      // Fetch RFC Message-ID (best-effort; failure doesn't block the send record)
      const rfcMessageId = await fetchRfcMessageId(messageId);

      // Update log
      await EmailLog.findByIdAndUpdate(log._id, {
        status: "sent",
        sentAt,
        gmailMessageId: messageId,
        gmailThreadId: returnedThreadId,
        rfcMessageId,
      });

      // Update contact
      const contactUpdate: Record<string, unknown> = {
        currentStage: log.stage,
      };

      if (log.stage === 1 && contact.pipelineStage === "not_started") {
        contactUpdate.pipelineStage = "contacted";
      }

      // Determine firstSentAt for spacing computation
      let firstSentAt: Date;
      if (log.stage === 1) {
        // This IS the first send
        firstSentAt = sentAt;
      } else {
        // Retrieve stage-1 sent log's sentAt
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
        // Sequence complete
        contactUpdate.nextSendAt = null;
      }

      await Contact.findByIdAndUpdate(contact._id, contactUpdate);

      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`log ${String(log._id)}: ${msg}`);
      // Leave log status "approved" so it retries next run
    }

    // Delay between sends (skip after the last one)
    if (i < approvedLogs.length - 1) {
      await sleep(randomDelayMs(SEND_DELAY_MIN_MS, SEND_DELAY_MAX_MS));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run summary type
// ---------------------------------------------------------------------------

export interface RunSummary {
  repliesChecked: number;
  draftsCreated: number;
  sent: number;
  skipped: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runSequenceEngine(): Promise<RunSummary> {
  const runStartMs = Date.now();

  await connectDB();

  // A: Check replies (Phase 9 stub)
  const repliesResult = await checkReplies();

  // B: Generate drafts
  const draftsResult = await generateDrafts();

  // C: Send approved
  const sendsResult = await sendApproved(runStartMs);

  return {
    repliesChecked: repliesResult.checked,
    draftsCreated: draftsResult.created,
    sent: sendsResult.sent,
    skipped: sendsResult.skipped,
    errors: [...draftsResult.errors, ...sendsResult.errors],
  };
}

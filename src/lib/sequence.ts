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
import CronRun from "@/models/CronRun";
import Suppression from "@/models/Suppression";
import { generateEmailDraft } from "@/lib/draft";
import { getSettings } from "@/lib/settings";
import { extractAndRewriteLinks, renderTrackedHtml, htmlEscape } from "@/lib/tracking";
import {
  sendGmailMessage,
  getGmailClient,
  getSenderAddress,
} from "@/lib/gmail";
import type { IEmailLog } from "@/models/EmailLog";
import type { IContact } from "@/models/Contact";
import type { ICampaign } from "@/models/Campaign";
import { randomUUID } from "crypto";
import type { Types } from "mongoose";
import { checkReplies } from "@/lib/replies";
import { applyPlaceholders } from "@/lib/compose";
import { suppressContact } from "@/lib/contacts";
import { envInt } from "@/lib/env";
import { isNonEmailChannel } from "@/lib/outreachLogs";
import { isSendableContactStatus } from "@/lib/sendGuards";

// ---------------------------------------------------------------------------
// Config constants (env-overridable, sane defaults)
// ---------------------------------------------------------------------------

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

/**
 * Cap on how many overdue-nextActionAt contacts sendActionReminders() loads
 * into memory / into the digest email HTML per run (Security hardening,
 * Wave C — this query was previously unbounded). 200 rows is already a large
 * digest email; a bigger backlog is surfaced via the "+N more" note instead
 * of growing the query without limit. See sendActionReminders().
 */
const ACTION_REMINDER_LIMIT = 200;

/**
 * EmailLog.lastSendError has a maxlength (Security hardening, Wave C — see
 * src/models/EmailLog.ts). Its value is often a driver/Gmail-API error
 * message, which is NOT under our control and can occasionally be very long
 * (stack-trace-shaped strings from some client library failures). Truncate
 * BEFORE writing so a hardening change (adding maxlength) never turns into a
 * ValidationError that crashes the middle of an engine run — the whole
 * reason this class of bug matters is that ValidationError here would itself
 * prevent the send-failure state transition from being recorded.
 */
const LAST_SEND_ERROR_MAX_LEN = 1900; // just under EmailLog.lastSendError's 2000 maxlength

function truncateForStorage(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

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

/**
 * Canonical fallback day offset for a given stage, used when `spacingDays` is
 * malformed/too short to index. Mirrors the [0,5,9] schema default
 * (`Campaign.sequenceSpacingDays`) index-for-index.
 */
function fallbackDaysForStage(stage: 1 | 2 | 3): number {
  return stage === 1 ? 0 : stage === 2 ? 5 : 9;
}

/**
 * Computes nextSendAt using RELATIVE spacing between two stages, for the case
 * where the usual absolute anchor (the stage-1 log's `sentAt`) doesn't exist —
 * e.g. a stage-2 log was created directly on a stage-0 contact (skipping
 * stage 1 entirely, which `POST /api/email-logs` currently allows), so there
 * is no stage-1 `sent` log to anchor the [0,5,9]-style absolute spacing to.
 *
 * `computeNextSendAt` always measures from a single fixed anchor (the
 * stage-1 send), so re-purposing it with `sentAt` (the CURRENT send, not
 * stage 1's) as if it were that anchor computes the wrong interval — e.g. a
 * stage-2 send with spacing [0,5,9] would schedule stage 3 a full 9 days
 * later instead of the intended 5→9 gap of 4 days.
 *
 * Instead, this computes the gap BETWEEN the two stages' configured offsets
 * (`spacingDays[nextStage-1] - spacingDays[logStage-1]`) and applies that
 * relative gap from `sentAt`. With the default [0,5,9], a stage 2 → 3
 * transition with no stage-1 anchor schedules stage 3 `9 - 5 = 4` days out.
 *
 * Guards:
 *  - A malformed/short `spacingDays` array falls back to the canonical
 *    [0,5,9]-equivalent offset for the missing index (same convention as
 *    `computeNextSendAt`'s own fallback), so a short array never produces
 *    `NaN`.
 *  - A negative computed interval (e.g. a misconfigured/out-of-order spacing
 *    array) clamps to 0 days (send immediately) rather than scheduling a
 *    `nextSendAt` before `sentAt`.
 *
 * Exported for unit tests — treat as internal to `advanceContactAfterSend`.
 */
export function computeRelativeNextSendAt(
  sentAt: Date,
  spacingDays: number[],
  logStage: 1 | 2 | 3,
  nextStage: 2 | 3
): Date {
  const logDays = spacingDays[logStage - 1] ?? fallbackDaysForStage(logStage);
  const nextDays = spacingDays[nextStage - 1] ?? fallbackDaysForStage(nextStage);
  const intervalDays = Math.max(0, nextDays - logDays);
  return new Date(sentAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Exported: advance Contact state after a log has been successfully sent
// ---------------------------------------------------------------------------

/**
 * Result of `advanceContactAfterSend`. Distinguishes the ordinary case
 * (`applied: true` — the guarded update matched and wrote) from the guarded
 * no-op case (`applied: false` — the contact's `currentStage` was already
 * `>= log.stage` at write time, so the update was skipped to avoid
 * regressing a later stage; see the monotonic-guard doc below). A no-op is
 * NOT an error: it means another request (or an earlier stage arriving late)
 * already advanced this contact past this log's stage. Callers may log it
 * for observability but should otherwise treat it as success.
 */
export type AdvanceContactResult =
  | { applied: true }
  | { applied: false; reason: string };

/**
 * Advances Contact state (currentStage, pipelineStage, nextSendAt) after a
 * log for `contact` has been successfully sent. This is the ONLY place that
 * logic lives — extracted from `sendOneLog` as a pure refactor (behaviour is
 * unchanged for the normal in-order case) so Phase 4's manual "mark sent"
 * endpoint (for facebook/instagram/phone touches sent by the human on that
 * platform) can share the exact same state transitions instead of
 * re-deriving them.
 *
 * Signature / design choice: `campaign` is an OPTIONAL parameter rather than
 * always re-loaded here. `sendOneLog` already has the campaign loaded (it
 * needs `sequenceSpacingDays` for threading/stage logic earlier in the same
 * call), so passing it in avoids a redundant query on the hot cron/send-batch
 * path. Phase 4's manual mark-sent endpoint won't have a campaign in hand at
 * the point it marks a log sent — when `campaign` is omitted, this function
 * loads it itself via `log.campaignId` (falling back to the schema default
 * `[0, 5, 9]` if the campaign is somehow missing, so a dangling reference
 * can't throw here). Both call shapes produce identical Contact state.
 *
 * Monotonic guard (fixes a regression bug): two logs belonging to the SAME
 * contact — e.g. a stage-1 and a stage-3 log both pending — can be marked
 * sent concurrently or out of order. The per-log atomic claim (draft/approved
 * → sending/sent) serialises requests for the SAME log, but nothing
 * previously serialised requests for DIFFERENT logs on the same contact: a
 * slower stage-1 request could land after a faster stage-3 request and
 * unconditionally overwrite `currentStage: 3` back down to `currentStage: 1`,
 * silently re-scheduling and re-contacting an already-finished contact. To
 * prevent this, the write is a conditional `Contact.findOneAndUpdate` guarded
 * on `currentStage: { $lt: log.stage }` — a lower-stage write can never
 * clobber a higher-stage one. When the guard doesn't match (no document
 * satisfies the condition), that's a no-op, not an error: `applied: false` is
 * returned so callers can log it distinguishably. In the ordinary in-order
 * case (the common path — Gmail sends via `sendOneLog`, and manual mark-sent
 * for a contact progressing stage 1 → 2 → 3 normally) the contact's
 * `currentStage` is always `< log.stage` at write time, so the guard always
 * matches and behaviour is unchanged from before this fix.
 *
 * Missing stage-1-anchor fallback (fixes a spacing bug): the usual case
 * anchors `nextSendAt` to the stage-1 log's `sentAt` (`computeNextSendAt`,
 * absolute spacing — unchanged, still the path taken whenever a stage-1
 * `sent` log exists). If no stage-1 `sent` log exists at all — e.g. a
 * stage-2 log was created directly on a stage-0 contact via
 * `POST /api/email-logs`, skipping stage 1 — there is no absolute anchor to
 * measure from. Previously this fell back to treating `sentAt` (THIS send,
 * not stage 1's) as the anchor, which measures the full absolute offset from
 * the wrong instant (e.g. scheduling stage 3 a full 9 days after a stage-2
 * send instead of the intended 4-day 2→3 gap). Now it falls back to
 * `computeRelativeNextSendAt`, which measures the gap BETWEEN the two
 * stages' configured offsets instead — see that function's doc comment.
 */
export async function advanceContactAfterSend(
  contact: IContact,
  log: IEmailLog,
  sentAt: Date,
  campaign?: Pick<ICampaign, "sequenceSpacingDays"> | null
): Promise<AdvanceContactResult> {
  let spacingDays = campaign?.sequenceSpacingDays;
  if (!spacingDays) {
    const loadedCampaign = (await Campaign.findById(log.campaignId)
      .select({ sequenceSpacingDays: 1 })
      .lean()) as Pick<ICampaign, "sequenceSpacingDays"> | null;
    spacingDays = loadedCampaign?.sequenceSpacingDays ?? [0, 5, 9];
  }

  const contactUpdate: Record<string, unknown> = {
    currentStage: log.stage,
  };
  if (log.stage === 1 && contact.pipelineStage === "not_started") {
    contactUpdate.pipelineStage = "contacted";
  }

  if (log.stage < 3) {
    const nextStage = (log.stage + 1) as 2 | 3;
    if (log.stage === 1) {
      // Stage 1 IS the anchor — no lookup needed (matches prior behaviour).
      contactUpdate.nextSendAt = computeNextSendAt(sentAt, spacingDays, nextStage);
    } else {
      const stage1Log = await EmailLog.findOne({
        contactId: contact._id,
        stage: 1,
        status: "sent",
      })
        .select({ sentAt: 1 })
        .lean();

      contactUpdate.nextSendAt = stage1Log?.sentAt
        ? computeNextSendAt(stage1Log.sentAt, spacingDays, nextStage)
        : computeRelativeNextSendAt(sentAt, spacingDays, log.stage as 1 | 2, nextStage);
    }
  } else {
    contactUpdate.nextSendAt = null;
  }

  const updated = await Contact.findOneAndUpdate(
    { _id: contact._id, currentStage: { $lt: log.stage } },
    contactUpdate
  );

  if (!updated) {
    const reason = `advanceContactAfterSend: no-op — contact ${String(contact._id)} currentStage already >= log stage ${log.stage}; guarded update skipped to avoid regressing a later/concurrent stage`;
    console.warn(`[sequence] ${reason}`);
    return { applied: false, reason };
  }

  return { applied: true };
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

/**
 * How many due-contact candidates to load before giving up on this run.
 * The loop below breaks as soon as `created >= DRAFTS_PER_RUN`, but it also
 * `continue`s past contacts that already have a log (idempotency) or that
 * turn out to be suppressed — so a strict `limit(DRAFTS_PER_RUN)` could
 * under-fill a run when many due contacts are skipped. A small multiple
 * gives the loop room to skip without re-introducing an unbounded query
 * (Security hardening, Wave C — this previously loaded every active due
 * contact into memory on every cron run, unbounded).
 */
const DRAFTS_CANDIDATE_LIMIT = DRAFTS_PER_RUN * 5;

async function generateDrafts(): Promise<DraftsResult> {
  const now = new Date();
  const result: DraftsResult = { created: 0, errors: [] };

  const contacts = await Contact.find({
    status: "active",
    nextSendAt: { $lte: now, $ne: null },
    currentStage: { $lt: 3 },
  })
    .sort({ nextSendAt: 1 })
    .limit(DRAFTS_CANDIDATE_LIMIT)
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
      //
      // Guarded on a non-empty contactEmail: for a non-email contact,
      // contactEmail is undefined, and `Suppression.findOne({ email: undefined })`
      // is NOT a safe no-op in MongoDB — it can match documents where the
      // `email` field is absent/null, which is not the intent here. Only
      // email-channel contacts (or legacy contacts that happen to have an
      // email) go through the Suppression list.
      if (typeof contact.contactEmail === "string" && contact.contactEmail) {
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

      // Generate draft via Claude — channel-aware (Phase 3): defaults to
      // "email" inside generateEmailDraft when outreachChannel is absent
      // (pre-migration contacts), so this is safe for legacy docs too.
      const draft = await generateEmailDraft({
        offerSummary: campaign.offerSummary,
        toneNotes: campaign.toneNotes,
        businessName: contact.businessName,
        contactName: contact.contactName,
        keyPoints: contact.keyPoints,
        stage: targetStage,
        previousEmails: previousEmails.length ? previousEmails : undefined,
        channel: contact.outreachChannel,
      });

      // Persist as draft — channel carried onto the log so downstream queries
      // (sendApproved, daily-cap counter, review queue) can tell email logs
      // apart from social/phone logs that require a manual send.
      await EmailLog.create({
        contactId: contact._id,
        campaignId: contact.campaignId,
        stage: targetStage,
        status: "draft",
        subject: draft.subject,
        body: draft.body,
        channel: contact.outreachChannel,
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

/** The fields the threading block reads off the anchor log. */
type ThreadingAnchor = Pick<IEmailLog, "gmailThreadId" | "rfcMessageId" | "subject">;

/**
 * Resolves the log whose Gmail headers this send should thread onto.
 *
 * Precedence:
 *  1. An explicit `replyToLogId` (set only by POST /api/os/drafts). A RikuOS
 *     response must thread onto the exact message it answers, which is not
 *     necessarily the highest-stage prior send. The lookup is scoped to the
 *     same contact AND to `status: "sent"`, so a caller-supplied id can never
 *     point the thread at another contact's message or at an unsent draft.
 *  2. Otherwise the pre-existing rule, unchanged: for stage 2–3, the
 *     highest-stage prior `sent` log for this contact.
 *  3. Stage 1 with no replyToLogId → null (no threading), as before.
 *
 * For every log written before replyToLogId existed this returns exactly what
 * the previous inline `if (log.stage > 1)` query returned.
 */
async function resolveThreadingAnchor(
  log: IEmailLog,
  contactId: Types.ObjectId
): Promise<ThreadingAnchor | null> {
  if (log.replyToLogId) {
    const explicit = (await EmailLog.findOne({
      _id: log.replyToLogId,
      contactId,
      status: "sent",
    }).lean()) as ThreadingAnchor | null;
    if (explicit) return explicit;
  }

  if (log.stage > 1) {
    return (await EmailLog.findOne({
      contactId,
      stage: { $lt: log.stage },
      status: "sent",
    })
      .sort({ stage: -1 })
      .lean()) as ThreadingAnchor | null;
  }

  return null;
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
    if (!contact || !isSendableContactStatus(contact.status, log)) {
      // Revert to draft — the contact is gone, or its status does not permit
      // THIS log to be sent. See src/lib/sendGuards.ts for the narrow "replied"
      // permit that RikuOS response drafts depend on. No point retrying either
      // way, so "draft" (not "approved") is correct.
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft", sendAttemptedAt: null });
      return {
        status: "skipped",
        contactName: contact?.businessName ?? "unknown",
        subject: log.subject,
        error: contact
          ? `contact status "${contact.status}" does not permit sending this log — reverted to draft`
          : "contact not found — reverted to draft",
      };
    }

    // Multi-channel guard: sendOneLog delivers via Gmail (email channel only).
    // A non-email log — or a contact with no email — must never reach Gmail; the
    // manual "Outreach Tasks" flow handles social/phone sends. Capture a narrowed
    // local so contactEmail is typed `string` for the Gmail call below.
    //
    // Uses isNonEmailChannel rather than `log.channel !== "email"` so that a
    // legacy log predating the `channel` field (channel absent/null) counts as
    // EMAIL — the same convention EMAIL_CHANNEL_QUERY uses to select logs.
    // The two must agree: sendApproved selects legacy channel-less logs, so a
    // `!== "email"` test here would refuse to send them and bounce them back to
    // draft forever. Hydrated Mongoose docs currently mask this (the schema
    // default fills `channel` on read), but a `.lean()` log would not — so the
    // guard is written to be correct either way rather than relying on that.
    const contactEmail = contact.contactEmail;
    if (isNonEmailChannel(log.channel) || !contactEmail) {
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft", sendAttemptedAt: null });
      return {
        status: "skipped",
        contactName: contact.businessName,
        subject: log.subject,
        error: "non-email channel — not sendable via Gmail; reverted to draft",
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

    // Threading. Anchor resolution lives in resolveThreadingAnchor() so an
    // explicit replyToLogId (RikuOS response drafts) can take precedence over
    // the stage-based lookup. Everything below this line is unchanged.
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;
    let subjectToSend = log.subject;

    const prevLog = await resolveThreadingAnchor(log, contact._id as Types.ObjectId);
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

    // Placeholder substitution at send time — case-insensitive and
    // path-independent (fills {{businessName}}/{{contactName}} regardless of
    // how the log was created: batch compose, single compose, or AI draft).
    subjectToSend = applyPlaceholders(subjectToSend, contact);
    let bodyToSend = applyPlaceholders(log.body, contact);

    // --- Unsubscribe link (Task 6.2) ---
    // Rationale: reduces reliance on the fragile keyword opt-out matcher and is
    // the single best deliverability investment; both mechanisms (link + reply STOP)
    // coexist — the existing "reply STOP" line is kept below.
    //
    // Appended AFTER placeholder substitution (token is not a placeholder),
    // BEFORE the tracking rewrite so the URL is present when renderTrackedHtml runs.
    // extractAndRewriteLinks deliberately excludes /api/unsubscribe/ URLs so this
    // link reaches the recipient as a plain anchor, not a click-tracked redirect.
    const baseUrl = process.env.APP_BASE_URL;
    if (baseUrl) {
      // Ensure the contact has an unsubscribeToken (pre-migration docs may lack one).
      let token: string = contact.unsubscribeToken ?? "";
      if (!token) {
        token = randomUUID();
        await Contact.findByIdAndUpdate(contact._id, { unsubscribeToken: token });
      }
      const unsubUrl = `${baseUrl}/api/unsubscribe/${token}`;
      bodyToSend = `${bodyToSend}\n\nUnsubscribe: ${unsubUrl}`;
    }

    // Tracking IDs (not persisted until post-send update so failed sends retry cleanly)
    const trackingPixelId = randomUUID();
    const { links } = extractAndRewriteLinks(bodyToSend);
    const htmlBody = renderTrackedHtml(bodyToSend, links, trackingPixelId);

    // Send — if this throws, we catch below and revert to "approved"
    let messageId: string;
    let returnedThreadId: string;
    try {
      const sendResult = await sendGmailMessage({
        to: contactEmail,
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
        lastSendError: truncateForStorage(errMsg, LAST_SEND_ERROR_MAX_LEN),
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

    // Update Contact (currentStage, pipelineStage, nextSendAt) — shared with
    // Phase 4's manual mark-sent path via advanceContactAfterSend below.
    await advanceContactAfterSend(contact, log, sentAt, campaign);

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
        lastSendError: truncateForStorage(`unexpected error: ${msg}`, LAST_SEND_ERROR_MAX_LEN),
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

/**
 * Migration-safe predicate matching only email-channel EmailLogs — an
 * explicit `channel: "email"`, OR a legacy log written before the `channel`
 * field existed (the field is absent, or was left `null`).
 *
 * WHY this exists: Gmail auto-send (sendApproved, and by extension
 * /api/send-batch's direct sendOneLog calls) must never pick up a non-email
 * log. Facebook/Instagram/phone touches are AI-drafted but SENT MANUALLY by
 * the human on that platform (Phase 4) — there is no Gmail message to send
 * for them. The same predicate also gates the daily-cap counter below, since
 * DAILY_SEND_CAP is a Gmail deliverability/warm-up budget that a manually
 * "marked sent" social/phone touch must not consume.
 *
 * Exported so its shape can be asserted directly in unit tests without a
 * live MongoDB connection (see sequence.test.ts).
 */
export const EMAIL_CHANNEL_QUERY: {
  $or: Array<{ channel: "email" } | { channel: { $exists: false } } | { channel: null }>;
} = {
  $or: [{ channel: "email" }, { channel: { $exists: false } }, { channel: null }],
};

async function sendApproved(runStartMs: number): Promise<SendsResult> {
  const result: SendsResult = { sent: 0, skipped: [], errors: [] };
  const now = new Date();

  if (!isWithinSendWindow(now)) {
    result.skipped.push("outside send window");
    return result;
  }

  // DAILY_SEND_CAP exists solely as a Gmail deliverability / domain warm-up
  // budget — it caps how many messages OUR Gmail account sends per day.
  // Facebook/Instagram/phone touches are marked "sent" manually (Phase 4)
  // after the user sends them by hand on that platform; those sends cost the
  // Gmail sender reputation nothing and must NOT eat into this budget, or
  // marking a batch of social touches "sent" in the morning would silently
  // stall all email sending for the rest of the Manila day. Shares
  // EMAIL_CHANNEL_QUERY with the approved-logs query below so both stay in
  // lockstep.
  const dayStart = getManilaDayStart(now);
  const sentToday = await EmailLog.countDocuments({
    status: "sent",
    sentAt: { $gte: dayStart },
    ...EMAIL_CHANNEL_QUERY,
  });
  const remaining = DAILY_SEND_CAP - sentToday;
  if (remaining <= 0) {
    result.skipped.push("daily cap reached");
    return result;
  }

  const batchLimit = Math.min(remaining, SENDS_PER_RUN);

  // Gmail auto-send must never pick up a non-email log — see
  // EMAIL_CHANNEL_QUERY above for why. This query filter alone doesn't fully
  // protect /api/send-batch's direct sendOneLog calls (a caller could still
  // pass a non-email log's id) — sendOneLog's own channel guard is the
  // defence-in-depth layer for that path.
  const approvedLogs = await EmailLog.find({
    status: "approved",
    ...EMAIL_CHANNEL_QUERY,
  })
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
  /** Number of contacts with nextActionAt <= now at the time of this run. */
  actionRemindersDue: number;
  /** True if an action-reminder digest email was sent this run. */
  actionDigestSent: boolean;
  /** False when this run skipped drafting because /settings has it turned off. */
  draftGenerationEnabled: boolean;
  /** False when this run skipped sending because /settings has it turned off. */
  sendingEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Exported pure helpers for next-action reminders (unit-testable, no DB)
// ---------------------------------------------------------------------------

/**
 * Returns true when a contact's nextActionAt is due (non-null and <= now).
 *
 * Exported for unit tests — treat as internal.
 */
export function isNextActionDue(nextActionAt: Date | null | undefined, now: Date): boolean {
  if (!nextActionAt) return false;
  return nextActionAt.getTime() <= now.getTime();
}

/**
 * Returns the number of whole days the action is overdue (positive integer)
 * or 0 when due today / in the future.
 *
 * "Days overdue" is computed in Manila time: we diff the Manila-day-start of
 * `now` against the Manila-day-start of `nextActionAt`. This means an action
 * due on Manila Monday is not "overdue" during Manila Monday itself (even if
 * the cron runs early morning UTC) — it becomes 1 day overdue on Manila Tuesday.
 *
 * Exported for unit tests — treat as internal.
 */
export function daysOverdue(nextActionAt: Date, now: Date): number {
  const actionDayStart = getManilaDayStart(nextActionAt);
  const nowDayStart    = getManilaDayStart(now);
  const diffMs = nowDayStart.getTime() - actionDayStart.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Returns true when an action-reminder digest should be suppressed because one
 * was already sent for this Manila calendar day.
 *
 * `lastActionDigestSentAt` is the `actionDigestSentAt` value from any prior
 * CronRun doc for the current Manila day (null/undefined = no prior digest).
 *
 * Exported for unit tests — treat as internal.
 */
export function shouldSuppressActionDigest(
  lastActionDigestSentAt: Date | null | undefined,
  now: Date
): boolean {
  if (!lastActionDigestSentAt) return false;
  const digestDay = getManilaDayStart(lastActionDigestSentAt);
  const nowDay    = getManilaDayStart(now);
  return digestDay.getTime() === nowDay.getTime();
}

// ---------------------------------------------------------------------------
// Phase D: sendActionReminders
// ---------------------------------------------------------------------------

interface ActionRemindersResult {
  due: number;
  digestSent: boolean;
  errors: string[];
}

/**
 * Queries contacts with nextActionAt <= now, throttles to one digest per Manila
 * day (separate from the error-digest throttle), and emails the user a list of
 * overdue next actions.
 *
 * Does NOT auto-clear nextActionAt — that clears only when the user acts via the
 * dashboard.
 */
async function sendActionReminders(cronRunId: string): Promise<ActionRemindersResult> {
  const result: ActionRemindersResult = { due: 0, digestSent: false, errors: [] };
  const now = new Date();

  const actionQuery = { nextActionAt: { $lte: now, $ne: null } };

  // True due count — kept unbounded (a single indexed count, not a document
  // load) so `result.due`/`actionRemindersDue` in the CronRun summary stays
  // accurate even when the list below is truncated.
  const totalDue = await Contact.countDocuments(actionQuery);
  result.due = totalDue;

  if (totalDue === 0) return result;

  // Query contacts with a due next action, bounded so an unbounded backlog
  // cannot load an unbounded array into memory / into the digest HTML
  // (Security hardening, Wave C). If the backlog exceeds the limit, the
  // truncation is surfaced in the email itself rather than silently dropped
  // — see the "+N more" row below.
  const dueContacts = await Contact.find(actionQuery)
    .sort({ nextActionAt: 1 }) // oldest-due first
    .limit(ACTION_REMINDER_LIMIT)
    .lean();

  // Throttle: one digest per Manila day — check prior runs for this day
  const dayStart = getManilaDayStart(now);
  const priorDigest = await CronRun.findOne({
    startedAt: { $gte: dayStart },
    actionDigestSentAt: { $ne: null },
    _id: { $ne: cronRunId },
  }).lean();

  if (priorDigest?.actionDigestSentAt) {
    // Already sent one today — suppress
    return result;
  }

  // Build the digest email
  const gmail = getGmailClient();
  let selfAddress: string | null = null;
  try {
    selfAddress = await getSenderAddress(gmail);
  } catch (addrErr) {
    result.errors.push(
      `Action reminders: could not resolve sender address — ${addrErr instanceof Error ? addrErr.message : String(addrErr)}`
    );
    return result;
  }

  if (!selfAddress) return result;

  const baseUrl = process.env.APP_BASE_URL ?? "";

  const rows = dueContacts.map((c) => {
    const name  = htmlEscape(c.businessName);
    const note  = c.nextActionNote ? htmlEscape(c.nextActionNote) : "<em>No note</em>";
    const days  = daysOverdue(c.nextActionAt!, now);
    const overdueTxt = days > 0 ? `${days}d overdue` : "Due today";
    const link  = baseUrl
      ? `<a href="${encodeURI(`${baseUrl}/contacts/${String(c._id)}`)}">${name}</a>`
      : name;
    return `<tr>
      <td style="padding:6px 12px 6px 0">${link}</td>
      <td style="padding:6px 12px 6px 0">${note}</td>
      <td style="padding:6px 0;white-space:nowrap">${htmlEscape(overdueTxt)}</td>
    </tr>`;
  }).join("\n");

  const reviewLink = baseUrl
    ? `<p><a href="${htmlEscape(baseUrl)}">Open dashboard</a></p>`
    : "";

  // Surface truncation explicitly rather than silently dropping items when
  // the backlog exceeds ACTION_REMINDER_LIMIT.
  const truncatedCount = totalDue - dueContacts.length;
  const truncationNote =
    truncatedCount > 0
      ? `<p><strong>+${truncatedCount} more</strong> overdue action${truncatedCount !== 1 ? "s" : ""} not shown — open the dashboard to see the full list.</p>`
      : "";

  const htmlBody = `
    <h2>Next-action reminders</h2>
    <p>${totalDue} contact${totalDue !== 1 ? "s" : ""} need${totalDue === 1 ? "s" : ""} your attention${truncatedCount > 0 ? ` (showing the ${dueContacts.length} most overdue)` : ""}:</p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 12px 4px 0;font-size:11px;text-transform:uppercase;color:#8E836C">Contact</th>
          <th style="text-align:left;padding:4px 12px 4px 0;font-size:11px;text-transform:uppercase;color:#8E836C">Note</th>
          <th style="text-align:left;padding:4px 0;font-size:11px;text-transform:uppercase;color:#8E836C">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${truncationNote}
    ${reviewLink}
  `.trim();

  try {
    await sendGmailMessage({
      to: selfAddress,
      subject: `[ShikksTracker] ${totalDue} follow-up action${totalDue !== 1 ? "s" : ""} due`,
      htmlBody,
    });

    // Mark the current CronRun doc with actionDigestSentAt
    await CronRun.findByIdAndUpdate(cronRunId, { actionDigestSentAt: new Date() });
    result.digestSent = true;
  } catch (sendErr) {
    result.errors.push(
      `Action reminders digest: send failed — ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`
    );
  }

  return result;
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
  const startedAt = new Date(runStartMs);

  await connectDB();

  // 0: Sweep stale "sending" logs before anything else — clears ambiguous state
  //    from a previous run that was killed after the Gmail call but before the DB update.
  const sweepResult = await sweepStaleSendingLogs();

  // A: Check replies (Phase 9 stub)
  const repliesResult = await checkReplies();

  const settings = await getSettings();

  // B: Generate drafts (skipped when /settings has drafting turned off)
  const draftsResult = settings.draftGenerationEnabled
    ? await generateDrafts()
    : { created: 0, errors: [] };

  // C: Send approved (skipped when /settings has sending turned off)
  const sendsResult = settings.sendingEnabled
    ? await sendApproved(runStartMs)
    : { sent: 0, skipped: [], errors: [] };

  // Build a partial summary (without action-reminder fields, which need cronRunId)
  const partialErrors = [...repliesResult.errors, ...draftsResult.errors, ...sendsResult.errors];
  const errorCount = partialErrors.length;
  const durationMs = Date.now() - runStartMs;

  // Persist the CronRun doc — must not throw out of the engine.
  let cronRunId: string | null = null;
  try {
    const cronRun = await CronRun.create({
      startedAt,
      durationMs,
      summary: {
        staleSendingReverted: sweepResult.reverted,
        repliesChecked: repliesResult.checked,
        replied: repliesResult.replied,
        unsubscribed: repliesResult.unsubscribed,
        bounced: repliesResult.bounced,
        draftsCreated: draftsResult.created,
        sent: sendsResult.sent,
        skipped: sendsResult.skipped,
        errors: partialErrors,
        actionRemindersDue: 0,
        actionDigestSent: false,
        draftGenerationEnabled: settings.draftGenerationEnabled,
        sendingEnabled: settings.sendingEnabled,
      } satisfies RunSummary,
      errorCount,
      digestSentAt: null,
      actionDigestSentAt: null,
    });
    cronRunId = String(cronRun._id);
  } catch (persistErr) {
    console.error("[sequence] CronRun persist failed:", persistErr);
    // Logging failure must not crash the engine — return summary as-is.
    return {
      staleSendingReverted: sweepResult.reverted,
      repliesChecked: repliesResult.checked,
      replied: repliesResult.replied,
      unsubscribed: repliesResult.unsubscribed,
      bounced: repliesResult.bounced,
      draftsCreated: draftsResult.created,
      sent: sendsResult.sent,
      skipped: sendsResult.skipped,
      errors: partialErrors,
      actionRemindersDue: 0,
      actionDigestSent: false,
      draftGenerationEnabled: settings.draftGenerationEnabled,
      sendingEnabled: settings.sendingEnabled,
    };
  }

  // D: Send next-action reminders (after CronRun is persisted so we can update it)
  let actionRemindersResult: ActionRemindersResult = { due: 0, digestSent: false, errors: [] };
  try {
    actionRemindersResult = await sendActionReminders(cronRunId);
  } catch (actionErr) {
    console.error("[sequence] action reminders step failed:", actionErr);
    actionRemindersResult.errors.push(
      `Action reminders step error: ${actionErr instanceof Error ? actionErr.message : String(actionErr)}`
    );
  }

  const summary: RunSummary = {
    staleSendingReverted: sweepResult.reverted,
    repliesChecked: repliesResult.checked,
    replied: repliesResult.replied,
    unsubscribed: repliesResult.unsubscribed,
    bounced: repliesResult.bounced,
    draftsCreated: draftsResult.created,
    sent: sendsResult.sent,
    skipped: sendsResult.skipped,
    errors: [...partialErrors, ...actionRemindersResult.errors],
    actionRemindersDue: actionRemindersResult.due,
    actionDigestSent: actionRemindersResult.digestSent,
    draftGenerationEnabled: settings.draftGenerationEnabled,
    sendingEnabled: settings.sendingEnabled,
  };

  // Update the persisted CronRun with final summary (including action-reminder results)
  try {
    await CronRun.findByIdAndUpdate(cronRunId, { summary });
  } catch (updateErr) {
    console.error("[sequence] CronRun summary update failed:", updateErr);
    // Non-fatal — proceed with return
  }

  // Error digest: send an email-to-self if there were errors OR any EmailLog
  // has been stuck with sendErrorCount >= 3. Throttle: one per Manila calendar day.
  try {
    // Count stuck logs (sendErrorCount >= 3 + still approved, i.e. still retrying)
    const stuckCount = await EmailLog.countDocuments({
      status: "approved",
      sendErrorCount: { $gte: 3 },
    });

    const shouldDigest = errorCount > 0 || stuckCount > 0;

    if (shouldDigest) {
      // Check whether any prior run in the same Manila day already sent a digest
      const dayStart = getManilaDayStart(new Date());
      const alreadySent = await CronRun.findOne({
        startedAt: { $gte: dayStart },
        digestSentAt: { $ne: null },
        // Exclude the current run itself (it has digestSentAt: null and we haven't set it yet)
        _id: { $ne: cronRunId },
      }).lean();

      if (!alreadySent) {
        // Build digest email
        const gmail = getGmailClient();
        let selfAddress: string | null = null;
        try {
          selfAddress = await getSenderAddress(gmail);
        } catch (addrErr) {
          console.warn("[sequence] digest: could not resolve sender address:", addrErr);
        }

        if (selfAddress) {
          // Fetch up to 3 example error messages
          const exampleErrors = summary.errors.slice(0, 3);

          // Fetch stuck log contact names (up to 5) for context
          let stuckNames = "";
          if (stuckCount > 0) {
            const stuckLogs = await EmailLog.find({
              status: "approved",
              sendErrorCount: { $gte: 3 },
            })
              .select({ contactId: 1 })
              .limit(5)
              .lean();
            const contactIds = stuckLogs.map((l) => l.contactId);
            const stuckContacts = await Contact.find({ _id: { $in: contactIds } })
              .select({ businessName: 1 })
              .lean();
            const names = stuckContacts.map((c) => htmlEscape(c.businessName)).join(", ");
            stuckNames = stuckCount > 5
              ? `${names} and ${stuckCount - 5} more`
              : names;
          }

          const runTimeStr = `${Math.round(durationMs / 1000)}s`;
          const errorListHtml = exampleErrors.length > 0
            ? `<ul>${exampleErrors.map((e) => `<li>${htmlEscape(e)}</li>`).join("")}</ul>`
            : "";
          const moreErrors = summary.errors.length > 3
            ? `<p>…and ${summary.errors.length - 3} more error(s) in this run.</p>`
            : "";
          const stuckHtml = stuckCount > 0
            ? `<p><strong>Stuck approved logs (sendErrorCount ≥ 3):</strong> ${stuckCount} — ${stuckNames}.<br>These logs have failed 3+ send attempts and are still queued. Investigate or manually discard them from the review page.</p>`
            : "";
          const baseUrl = process.env.APP_BASE_URL;
          const reviewLink = baseUrl
            ? `<p><a href="${htmlEscape(baseUrl)}/review">Open review page</a></p>`
            : "";

          const htmlBody = `
            <h2>Sequence engine error digest</h2>
            <p><strong>Run time:</strong> ${htmlEscape(runTimeStr)} &nbsp;|&nbsp;
               <strong>Errors this run:</strong> ${errorCount} &nbsp;|&nbsp;
               <strong>Sent:</strong> ${summary.sent}</p>
            ${errorListHtml}${moreErrors}${stuckHtml}${reviewLink}
          `.trim();

          try {
            await sendGmailMessage({
              to: selfAddress,
              subject: `[ShikksTracker] Engine errors — ${errorCount} error(s), ${stuckCount} stuck log(s)`,
              htmlBody,
            });

            // Mark digestSentAt on the current CronRun doc
            await CronRun.findByIdAndUpdate(cronRunId, { digestSentAt: new Date() });
          } catch (sendErr) {
            console.warn("[sequence] digest: send failed:", sendErr);
            // Digest send failure must not crash the engine.
          }
        }
      }
    }
  } catch (digestErr) {
    console.error("[sequence] digest check failed:", digestErr);
    // Digest machinery failure must not crash the engine.
  }

  return summary;
}

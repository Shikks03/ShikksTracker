/**
 * Pure helpers for the multi-channel "Outreach Tasks" board — Phase 4 (API half).
 *
 * Facebook/Instagram/phone touches are AI-drafted but SENT MANUALLY by the
 * human on that platform (there is no Gmail message to send for them). This
 * module holds the query predicate and status-transition guard those routes
 * need, kept here (rather than inline in the route handlers) so they can be
 * unit-tested without a live MongoDB connection — matching the "routes stay
 * thin, business logic in src/lib/" convention documented in CLAUDE.md.
 */

export const NON_EMAIL_CHANNELS = ["facebook", "instagram", "phone"] as const;
export type NonEmailChannel = (typeof NON_EMAIL_CHANNELS)[number];
export type OutreachChannel = "email" | NonEmailChannel;

/**
 * Migration-safe predicate matching only NON-email EmailLogs — the inverse of
 * `EMAIL_CHANNEL_QUERY` in src/lib/sequence.ts.
 *
 * Deliberately an explicit `channel: { $in: [...] }` rather than `channel: {
 * $ne: "email" }` — the latter would ALSO match legacy logs that predate the
 * `channel` field (channel absent/null), which are in fact email logs written
 * before the multi-channel migration. Those must never leak into the manual
 * "Outreach Tasks" board (Task 1 spec).
 */
export const NON_EMAIL_CHANNEL_QUERY: { channel: { $in: readonly NonEmailChannel[] } } = {
  channel: { $in: NON_EMAIL_CHANNELS },
};

/**
 * Channels the /outreach board shows, as of P2's lane split (2026-08-30).
 *
 * Facebook moved to /messenger, which has the conversation context that makes a
 * DM draft reviewable. This is a DISPLAY subset and nothing more.
 *
 * It is deliberately NOT a narrowing of NON_EMAIL_CHANNELS. That constant
 * defines "not an email log" and gates checkMarkSentAllowed and (inversely)
 * Gmail auto-send. Facebook logs are still non-email logs, still hand-sent,
 * still marked sent through the same route — they are just rendered somewhere
 * else. Removing facebook from NON_EMAIL_CHANNELS would 400 every facebook
 * Mark sent in /messenger.
 */
export const OUTREACH_BOARD_CHANNELS = ["instagram", "phone"] as const;

export const OUTREACH_BOARD_CHANNEL_QUERY: {
  channel: { $in: readonly NonEmailChannel[] };
} = { channel: { $in: OUTREACH_BOARD_CHANNELS } };

/** Statuses the outreach-logs list endpoint accepts via `?status=`. */
export const VALID_OUTREACH_LOG_STATUSES = new Set(["draft", "approved", "sending", "sent"]);

/**
 * Default status set for GET /api/outreach-logs when `?status=` is omitted.
 *
 * The review-before-send gate ("draft" vs "approved") exists so a human can
 * check AI-drafted text before Gmail auto-sends it. For facebook/instagram/
 * phone that gate is meaningless — there is no auto-send; the human reads
 * the message as they paste it onto the platform by hand. So the board must
 * surface both "draft" AND "approved" non-email logs by default, or a
 * composed-and-approved social message (see the two manual compose routes)
 * would be invisible on the board forever.
 */
export const DEFAULT_OUTREACH_LOG_STATUSES = ["draft", "approved"] as const;

export type OutreachLogStatusFilterResult =
  | { ok: true; filter: { status: string } | { status: { $in: readonly string[] } } }
  | { ok: false; httpStatus: 400; error: string };

/**
 * Resolves the `status` Mongo filter for GET /api/outreach-logs from the raw
 * `?status=` query param.
 *
 *  - Absent (`null`) → both "draft" and "approved" (see
 *    DEFAULT_OUTREACH_LOG_STATUSES above).
 *  - Present → validated against VALID_OUTREACH_LOG_STATUSES and matched
 *    exactly (today's behaviour, unchanged) — an explicit `?status=sent`
 *    means sent, not "sent or approved".
 *  - Present but invalid → 400, same message the route returned before this
 *    was extracted.
 *
 * Pure and DB-free so the filter shape is unit-testable without mocking
 * Mongoose, matching NON_EMAIL_CHANNEL_QUERY / checkMarkSentAllowed above.
 */
export function resolveOutreachLogStatusFilter(
  status: string | null
): OutreachLogStatusFilterResult {
  if (status == null) {
    return { ok: true, filter: { status: { $in: DEFAULT_OUTREACH_LOG_STATUSES } } };
  }

  if (!VALID_OUTREACH_LOG_STATUSES.has(status)) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Invalid status: ${status}. Must be one of: draft, approved, sending, sent.`,
    };
  }

  return { ok: true, filter: { status } };
}

/**
 * Whether a `subject` is required for a log/contact on the given channel.
 *
 * The EmailLog schema requires `subject` only when `channel === "email"`
 * (see src/models/EmailLog.ts). Facebook/Instagram DMs and phone scripts
 * have no subject line at all. Legacy channel-less values are treated as
 * email (`isNonEmailChannel` returns false for null/undefined), matching the
 * convention documented on that function.
 */
export function isSubjectRequiredForChannel(
  channel: string | null | undefined
): boolean {
  return !isNonEmailChannel(channel);
}

/**
 * Whether a `subject` is required for a batch of logs/contacts spanning the
 * given channels — used by POST /api/email-logs/batch and the /compose
 * multi-select form, where a single submission can mix email and
 * facebook/instagram/phone recipients.
 *
 * Rule: required if AND ONLY IF at least one channel in the list requires a
 * subject per `isSubjectRequiredForChannel` (i.e. at least one email — or
 * legacy null/undefined, which counts as email — recipient is present). An
 * all-non-email selection allows an empty subject through.
 *
 * Empty-selection edge case: returns `false` (not required). An empty list
 * has no email recipient to require a subject for, so there is nothing to
 * block on subject grounds — the caller's separate "at least one recipient"
 * validation is responsible for rejecting an empty selection outright.
 */
export function isSubjectRequiredForChannels(
  channels: ReadonlyArray<string | null | undefined>
): boolean {
  return channels.some((channel) => isSubjectRequiredForChannel(channel));
}

/**
 * Returns true when `channel` is a valid non-email channel value — used to
 * validate the optional `?channel=` query param on GET /api/outreach-logs,
 * and (as the inverse) to guard POST /api/outreach-logs/[id]/mark-sent.
 *
 * Accepts `string | null | undefined` rather than just `string`: a
 * pre-migration EmailLog has no `channel` field in the stored document at
 * all (the schema default only applies to documents created after the field
 * existed, and never applies to `.lean()` reads of pre-existing docs), so a
 * legacy log's `channel` is `undefined` at runtime despite the type saying
 * otherwise. Both null and undefined return `false` here (i.e. "treat as
 * email"), matching `EMAIL_CHANNEL_QUERY` in src/lib/sequence.ts.
 */
export function isNonEmailChannel(
  channel: string | null | undefined
): channel is NonEmailChannel {
  if (channel == null) return false;
  return (NON_EMAIL_CHANNELS as readonly string[]).includes(channel);
}

// ---------------------------------------------------------------------------
// mark-sent guard
// ---------------------------------------------------------------------------

export interface MarkSentCandidate {
  channel: OutreachChannel | null | undefined;
  status: "draft" | "approved" | "sending" | "sent";
  /**
   * The contact's current `currentStage` (0-3) at the time of this request.
   * Used to distinguish a genuine double-click 409 from a repairable
   * "log was marked sent but the contact was never advanced" state (see the
   * `"sent"` branch below).
   *
   * When the contact is missing/unknown, pass `Number.POSITIVE_INFINITY` (or
   * any value >= `logStage`) — a missing contact can never be "repaired" (there
   * is nothing to advance), so this guarantees the guard falls through to the
   * ordinary 409 rather than incorrectly entering `mode: "repair"`.
   */
  contactCurrentStage: number;
  /** The stage (1-3) this log represents. */
  logStage: number;
}

export type MarkSentGuardResult =
  | { ok: true; mode: "claim" | "repair" }
  | { ok: false; httpStatus: 400 | 409; error: string };

/**
 * Guards POST /api/outreach-logs/[id]/mark-sent before any DB write.
 *
 * Order matters:
 *  1. Anything that is NOT a recognised non-email channel is rejected — this
 *     covers an explicit `channel: "email"` AND a legacy log with `channel`
 *     absent/null (see `isNonEmailChannel` above for why those must be
 *     treated the same: a pre-migration log with no channel field is an
 *     email log). Email logs must go through the Gmail send path
 *     (sendOneLog), never be hand-marked. This is the mirror of the
 *     invariant sendOneLog enforces in the other direction (it refuses to
 *     Gmail-send a non-email log).
 *  2. `"sending"` → 409 (a Gmail send should never be in flight for a
 *     non-email log, but this state is rejected defensively all the same).
 *  3. Already `"sent"`:
 *       - `contactCurrentStage < logStage` → `mode: "repair"`. The log was
 *         successfully claimed sent by a PRIOR request, but that request (or
 *         a retry of it) never got as far as advancing the contact's
 *         stage/pipeline/nextSendAt — e.g. a transient Mongo error between
 *         the claim and `advanceContactAfterSend`. Retrying used to 409
 *         forever here, permanently stranding the contact at a stale stage
 *         (see CLAUDE.md Bug 1). The caller should skip the claim (it already
 *         happened) and just run `advanceContactAfterSend`.
 *       - `contactCurrentStage >= logStage` → 409. The advance already
 *         happened (or the contact has moved past this stage some other
 *         way) — this is the genuine double-click case, and returning success
 *         here would double-advance the contact.
 *  4. `"draft"` / `"approved"` → `mode: "claim"` (the ordinary path: atomically
 *     claim `draft|approved → sent`, then advance the contact).
 *
 * Pure and DB-free so it's unit-testable without mocking Mongoose — the route
 * calls this first and only proceeds to a DB write on `ok: true`.
 */
export function checkMarkSentAllowed(candidate: MarkSentCandidate): MarkSentGuardResult {
  if (!isNonEmailChannel(candidate.channel)) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        "Email logs must be sent via the Gmail send path — mark-sent is only for facebook/instagram/phone logs.",
    };
  }

  if (candidate.status === "sending") {
    return {
      ok: false,
      httpStatus: 409,
      error: "This log is currently sending — try again shortly.",
    };
  }

  if (candidate.status === "sent") {
    if (candidate.contactCurrentStage < candidate.logStage) {
      return { ok: true, mode: "repair" };
    }
    return {
      ok: false,
      httpStatus: 409,
      error: "This log has already been marked sent.",
    };
  }

  return { ok: true, mode: "claim" };
}

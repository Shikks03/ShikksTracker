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

/** Statuses the outreach-logs list endpoint accepts via `?status=`. */
export const VALID_OUTREACH_LOG_STATUSES = new Set(["draft", "approved", "sending", "sent"]);

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
}

export type MarkSentGuardResult =
  | { ok: true }
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
 *  2. Already `"sent"` → 409 (protects against a double-click marking twice
 *     and double-advancing the contact's stage).
 *  3. `"sending"` → 409 (a Gmail send should never be in flight for a
 *     non-email log, but this state is rejected defensively all the same).
 *  4. `"draft"` / `"approved"` → allowed.
 *
 * Pure and DB-free so it's unit-testable without mocking Mongoose — the route
 * calls this first and only proceeds to the atomic claim update on `ok: true`.
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

  if (candidate.status === "sent") {
    return {
      ok: false,
      httpStatus: 409,
      error: "This log has already been marked sent.",
    };
  }

  if (candidate.status === "sending") {
    return {
      ok: false,
      httpStatus: 409,
      error: "This log is currently sending — try again shortly.",
    };
  }

  return { ok: true };
}

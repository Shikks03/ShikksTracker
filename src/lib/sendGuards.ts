/**
 * sendGuards.ts — pure send-eligibility predicates.
 *
 * Extracted from src/lib/sequence.ts (2026-08-28, RikuOS P1) rather than adding
 * another inline condition to a 1400-line file, and so the rule can be asserted
 * without a live MongoDB connection — the same reasoning behind
 * checkMarkSentAllowed in src/lib/outreachLogs.ts.
 */

/** The subset of an EmailLog that sendability depends on. */
export interface SendabilityLog {
  origin?: string | null;
  replyToLogId?: unknown;
}

/**
 * Whether sendOneLog may deliver `log` to a contact in `status`.
 *
 * BACKGROUND (spec §D.2 ⚠️): until 2026-08-28 this was a bare
 * `contact.status !== "active"` test, so a log addressed to a contact who had
 * REPLIED was bounced back to "draft" and never sent. That is right for the
 * cold sequence — a replied contact must not keep receiving scheduled touches —
 * but wrong for a response *to* that reply, which is exactly what RikuOS's
 * follow-up chaser produces via POST /api/os/drafts.
 *
 * The permit is deliberately narrow:
 *   - "active"  → always sendable (unchanged).
 *   - "replied" → sendable ONLY for a log that is itself a response: created by
 *     RikuOS (origin "rikuos") or explicitly threaded onto a prior message
 *     (replyToLogId set). An ordinary sequence log stays blocked.
 *   - "paused" / "bounced" / "unsubscribed" → never sendable, no exceptions and
 *     no origin override. "paused" is a human's explicit stop; "bounced" and
 *     "unsubscribed" are deliverability and legal obligations (SPEC §14, PH Data
 *     Privacy Act). Suppression is re-checked separately inside sendOneLog.
 *
 * Any other/absent status fails closed.
 */
export function isSendableContactStatus(
  status: string | null | undefined,
  log: SendabilityLog
): boolean {
  if (status === "active") return true;
  if (status !== "replied") return false;
  return log.origin === "rikuos" || log.replyToLogId != null;
}

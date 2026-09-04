/**
 * Link suggestions — spec §A.4.
 *
 * Meta gives us only an anonymous, page-scoped PSID. It cannot be derived from
 * Contact.facebook, so a human confirms the match. This ranks the candidates
 * for that one tap.
 */

import { tokenSimilarity } from "@/lib/messenger/similarity";

export interface LinkCandidate {
  _id: string;
  businessName: string;
  contactName: string | null;
  /** We have a `sent` facebook log for them. */
  hasSentFacebookLog: boolean;
  /** They already replied — so they are a much weaker candidate for a NEW
   *  unlinked conversation. */
  hasReplied: boolean;
}

export interface LinkSuggestion {
  contactId: string;
  businessName: string;
  score: number;
}

export const MAX_LINK_SUGGESTIONS = 3;

/** Additive, not multiplicative: a boost must never resurrect a zero-overlap
 *  name. "We messaged them" is a tiebreak among plausible names, not evidence
 *  on its own. */
const AWAITING_REPLY_BOOST = 0.15;

export function rankLinkSuggestions(
  displayName: string,
  candidates: readonly LinkCandidate[]
): LinkSuggestion[] {
  // A failed profile fetch leaves displayName empty. Every candidate would
  // score 0 and the UI would present arbitrary rows as if they were matches.
  // Show nothing and let the user search.
  if (normalizedIsEmpty(displayName)) return [];

  return candidates
    .map((c) => {
      const base = Math.max(
        tokenSimilarity(displayName, c.businessName),
        c.contactName ? tokenSimilarity(displayName, c.contactName) : 0
      );
      const boost = c.hasSentFacebookLog && !c.hasReplied ? AWAITING_REPLY_BOOST : 0;
      return { contactId: c._id, businessName: c.businessName, score: base > 0 ? base + boost : 0 };
    })
    .filter((s) => s.score > 0)
    // Ties break on contactId so the order is stable across renders and
    // testable — Mongo's document order is unspecified, same reasoning as
    // selectLeastUsedVariant in src/lib/variants.ts.
    .sort((a, b) => b.score - a.score || (a.contactId < b.contactId ? -1 : 1))
    .slice(0, MAX_LINK_SUGGESTIONS);
}

function normalizedIsEmpty(s: string): boolean {
  return s.trim().length === 0;
}

// ---------------------------------------------------------------------------
// Reply anchor selection (the retroactive-effects path)
// ---------------------------------------------------------------------------

/** Just enough of a MessengerMessage to choose an anchor. */
export interface AnchorCandidate {
  sentAt: Date;
  text: string;
}

/**
 * Which stored inbound message counts as "they replied", when a conversation
 * is linked to a Contact after the fact.
 *
 * PRIMARY RULE, unchanged: the EARLIEST inbound message since our last
 * outbound. In a running conversation that is the one that constitutes a
 * reply — anything older was already answered, and taking the newest would
 * misdate the reply.
 *
 * THE FALLBACK, and why it has to exist. The primary rule silently produced
 * NO anchor for the ordinary case, so linking a real prospect applied no
 * reply effects at all: they stayed `not_started` with no engagement bump and
 * their queued follow-ups intact. Two ways a conversation arrives with every
 * inbound message older than `lastOutboundAt`:
 *
 *   1. The Page has an automated greeting / instant reply configured. It fires
 *      within SECONDS of a first-ever inbound message and is echoed back to us
 *      as an outbound. `lastOutboundAt` is therefore newer than the prospect's
 *      message before any human has seen it — this is the DEFAULT state of a
 *      Page with a greeting, not an edge case.
 *   2. The operator answered from the Page inbox on their phone before getting
 *      round to linking in the dashboard, which is the natural order of events.
 *
 * In both, the prospect plainly did message us, so falling back to the most
 * recent inbound message is right: it is the freshest thing they actually said,
 * and it is what a human reading the thread would point at.
 *
 * Replaying this cannot double-count. `applyReplyEffects` is idempotent on the
 * anchor log's `replied` flag, or on the contact's own status when no sent log
 * exists, so re-linking applies effects at most once.
 *
 * Pure so it is testable — the route does the querying.
 *
 * @param inboundAsc inbound messages for the conversation, ascending by sentAt
 * @param lastOutboundAt the conversation's last outbound timestamp, if any
 */
export function pickReplyAnchor<T extends AnchorCandidate>(
  inboundAsc: readonly T[],
  lastOutboundAt: Date | null | undefined
): T | null {
  if (inboundAsc.length === 0) return null;

  if (lastOutboundAt) {
    const cutoff = new Date(lastOutboundAt).getTime();
    const since = inboundAsc.find((m) => new Date(m.sentAt).getTime() > cutoff);
    if (since) return since;
  }

  // No outbound yet, or every inbound predates it (see the two cases above).
  return inboundAsc[inboundAsc.length - 1];
}

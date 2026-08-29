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

/**
 * Normalised token similarity. Shared by link suggestions (display name vs
 * business name) and echo matching (typed message vs pending draft).
 *
 * Deliberately not an AI call (spec §A.4): this runs on every unlinked
 * conversation render, needs to be deterministic for tests, and token overlap
 * is sufficient for "does this Facebook display name look like this business".
 */

/** Words that carry no identifying signal in a Philippine business name and
 *  would otherwise let any two companies match on "services" or "inc". */
const NOISE = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd",
  "the", "and", "of", "ph", "philippines", "services", "service", "shop",
  "store", "official", "page",
]);

export function normalizedTokens(input: string): string[] {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents: "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t));
}

/**
 * Jaccard overlap over normalised token sets. 0 when either side is empty --
 * two empty sets are not "identical", they are "no information".
 */
export function tokenSimilarity(a: string, b: string): number {
  const setA = new Set(normalizedTokens(a));
  const setB = new Set(normalizedTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

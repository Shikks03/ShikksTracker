/**
 * text.ts — code-point-safe truncation for the /api/os/* payloads.
 *
 * `.slice(0, n)` counts UTF-16 code units, and this text is third-party content
 * (reply bodies, business names, scraped key points) that really does contain
 * emoji — a naive slice can land inside a surrogate pair and emit half a
 * character. Same reasoning already documented in src/lib/replies.ts
 * (truncateReplyBody) and src/lib/scraperCsv.ts.
 */

/** Truncate to `max` code points. No marker is appended. */
export function truncateCodePoints(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

/** Truncate to `max` code points, appending "…" when anything was cut. */
export function truncateWithEllipsis(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("") + "…";
}

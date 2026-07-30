/**
 * email.ts — Pure email helpers with no server-only dependencies.
 *
 * Extracted from contacts.ts so client components (e.g. the import preview)
 * can import these without pulling in Mongoose or Node.js server modules.
 * contacts.ts re-exports everything from here for backward compatibility.
 */

/** Trim and lowercase an email address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pragmatic email validation — not RFC-5321 complete, but handles the
 * vast majority of real-world addresses while rejecting obvious junk.
 *
 * Mirrors the regex used in contacts.ts / createContactChecked so that
 * client-side preview classification matches server-side validation.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/**
 * Escape special regex metacharacters in a user-supplied string so it can be
 * safely embedded in a `$regex` filter without being interpreted as a pattern
 * (e.g. a business name like "Mang Inasal (Session Rd.)" must match literally,
 * not have its parentheses/period treated as regex syntax).
 *
 * Callers: createContactChecked's case-insensitive businessName dedupe
 * (contacts.ts) and the suppression search filter (api/suppressions/route.ts,
 * which held an identical private copy until this shared one replaced it).
 *
 * Placement note: this is a generic string helper rather than an email one.
 * It lives here because email.ts is already the shared pure-helper module both
 * callers import; if a third unrelated caller appears, move it to its own
 * module rather than growing email.ts into a grab bag.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

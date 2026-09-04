/**
 * legal.ts — the handful of facts the public legal pages need.
 *
 * These pages exist because Meta's App Review requires a reachable Privacy
 * Policy URL, a Terms URL and user-data-deletion instructions before an app can
 * leave Development mode. They are the only routes on this site meant to be read
 * by someone who is not Riku, so they are public in src/proxy.ts.
 *
 * A reviewer clicks the contact address, so it must be a real monitored mailbox.
 * If a registered business name is ever used for Meta's business verification,
 * OPERATOR_NAME should be changed to match it — the two are compared.
 */

/** Legal name of whoever operates this tool. The trade name "Riku" is
 *  deliberately omitted until it is DTI-registered (legal review 2026-09-04:
 *  publishing "trading as <unregistered name>" is a written admission of an
 *  RA 3883 violation, while the bare true name needs no registration). Once
 *  registered, restore it as:
 *  "Shikkari Ipil, trading as Riku (DTI Business Name Reg. No. ____)". */
export const OPERATOR_NAME = "Shikkari Ipil";

/** Monitored address for privacy requests. Must actually be read. */
export const CONTACT_EMAIL = "riku.mnl26@gmail.com";

/** Bump when the substance changes, not on a typo fix. */
export const LAST_UPDATED = "4 September 2026";

/** Where these documents are served from. */
export const SITE_ORIGIN = "https://shikkstracker.vercel.app";

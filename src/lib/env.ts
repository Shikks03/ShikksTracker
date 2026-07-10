/**
 * env.ts — small server-side env helpers.
 *
 * Consolidated 2026-07-11 (Task 5.1): `envInt` was previously copy-pasted in
 * sequence.ts, contacts/route.ts, and send-batch/route.ts.
 */

/** Parse an integer environment variable, falling back when unset or invalid. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

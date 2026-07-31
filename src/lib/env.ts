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

/**
 * Parse a `limit` query param, clamped to `[1, max]`. Falls back to `def`
 * when the param is absent or fails to parse to a finite number — modeled
 * on the one place in the codebase that already got this right
 * (src/app/api/cron-runs/route.ts), now shared so every unbounded list
 * route (security-phase-2, Wave C) can bound its result set the same way.
 */
export function parseLimit(searchParams: URLSearchParams, def: number, max: number): number {
  const raw = searchParams.get("limit");
  if (!raw) return def;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return def;
  return Math.min(Math.max(1, parsed), max);
}

/**
 * Parse an `offset` query param, clamped to `[0, max]`, default 0. Sibling
 * to `parseLimit` for the same list-route pagination need.
 */
export function parseOffset(searchParams: URLSearchParams, max: number): number {
  const raw = searchParams.get("offset");
  if (!raw) return 0;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(0, parsed), max);
}

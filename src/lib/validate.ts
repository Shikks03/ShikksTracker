/**
 * validate.ts — Small hand-rolled type guards for untrusted request input.
 *
 * House style: explicit `typeof` checks and `Set` whitelists (see
 * src/app/api/contacts/route.ts), not a schema library. No new npm
 * dependency is introduced here.
 *
 * The primary motivation is NoSQL-injection defence: an unvalidated request
 * body field (e.g. `campaignId`) can be an object like `{"$ne": null}`,
 * which — if passed straight into a Mongo filter — becomes a valid operator
 * expression instead of an equality match. `asObjectIdString` is the core
 * guard against that: it only ever returns a plain string that is also a
 * valid Mongo ObjectId, never the original value.
 */

import { NextResponse } from "next/server";
import mongoose from "mongoose";

/**
 * Returns `v` only if it is a string AND a valid Mongo ObjectId string.
 * Rejects objects (including operator-injection payloads like
 * `{ $ne: null }`), arrays, numbers, booleans, null, undefined, and
 * malformed hex strings.
 */
export function asObjectIdString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if (!mongoose.isValidObjectId(v)) return null;
  return v;
}

/**
 * Returns the trimmed string if `v` is a string, trims to non-empty, and is
 * within `maxLen`; otherwise null.
 */
export function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

/**
 * Same rules as `asString`, but for optional fields: null/undefined input
 * passes through as `undefined` (field simply absent), while an invalid
 * non-null value also yields `undefined` rather than null — callers treat
 * "not provided" and "provided but invalid" the same way for optional
 * fields (the field is just omitted from whatever gets built).
 */
export function asOptionalString(v: unknown, maxLen: number): string | undefined {
  if (v === null || v === undefined) return undefined;
  const result = asString(v, maxLen);
  return result === null ? undefined : result;
}

export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Validate sequenceSpacingDays: must be an array of exactly 3 non-negative
 * numbers that are strictly increasing and start at 0.
 * Returns the validated array on success, or null on failure.
 *
 * MOVED here (2026-08 security-phase-2) from src/app/api/campaigns/route.ts
 * so the PATCH path can share the same validation as POST — the exact
 * original semantics are preserved unchanged. Hardened with two additional
 * checks not present in the original: a bound on array length and a
 * finite-integer-in-range check per element, so a huge or malformed array
 * (or a NoSQL-injection object smuggled in as an array element) can't reach
 * the database.
 *
 * NOTE: src/app/api/campaigns/route.ts still has its own local copy of this
 * function as of this change — this file's owner did not modify that route
 * (out of ownership scope). A later agent must replace that local copy with
 * `import { validateSequenceSpacingDays } from "@/lib/validate"` so POST and
 * PATCH share one implementation.
 */
export function validateSequenceSpacingDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length !== 3) return null;
  if (value.length > 10) return null;
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item) || !Number.isInteger(item)) {
      return null;
    }
    if (item < 0 || item > 365) return null;
  }
  if (value[0] !== 0) return null;
  if (value[1] <= value[0] || value[2] <= value[1]) return null;
  return value as number[];
}

/**
 * Meta webhook authentication — spec §A.2.
 *
 * Two independent checks, both timing-safe:
 *   GET  — the one-time verify-token handshake when the callback URL is added.
 *   POST — X-Hub-Signature-256 over the RAW request body, on every event.
 *
 * Pure and Request-free so both are unit-testable without constructing a
 * NextRequest — the same convention as checkOsSecret in src/lib/auth.ts.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type MetaAuthFailure = { ok: false; httpStatus: 401 | 403 | 503; error: string };
export type MetaSignatureResult = { ok: true } | MetaAuthFailure;
export type MetaVerifyResult = { ok: true; challenge: string } | MetaAuthFailure;

/** SHA-256 both sides so timingSafeEqual always gets equal-length buffers.
 *  Comparing raw values would throw on a length mismatch, and that throw
 *  itself leaks the length. Same construction as requireCronSecret. */
function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/**
 * Verifies `X-Hub-Signature-256: sha256=<hex>` against HMAC-SHA256 of the raw
 * body under META_APP_SECRET.
 *
 * `rawBody` MUST be the exact bytes Meta sent. Read it with `await
 * request.text()` and parse afterwards — never `await request.json()` first.
 * JSON.parse followed by JSON.stringify reorders keys and drops whitespace, so
 * a re-serialised body produces a different HMAC and every genuine event would
 * be rejected as forged. There is a test pinning exactly this.
 *
 * Fails CLOSED (503) when the secret is unset. An unsigned public endpoint that
 * writes to the contact pipeline is not a degraded mode, it is an open door.
 */
export function verifyMetaSignature(
  rawBody: string,
  headerValue: string | null,
  appSecret: string | undefined
): MetaSignatureResult {
  if (!appSecret) {
    return {
      ok: false,
      httpStatus: 503,
      error: "META_APP_SECRET is not configured.",
    };
  }

  if (!headerValue || !headerValue.startsWith("sha256=")) {
    return {
      ok: false,
      httpStatus: 401,
      error: "Missing or malformed X-Hub-Signature-256 header.",
    };
  }

  const provided = headerValue.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  // Compare the hex STRINGS via sha256() rather than Buffer.from(hex) — a
  // malformed hex header would decode to a short/empty buffer and throw.
  if (!timingSafeEqual(sha256(provided), sha256(expected))) {
    return { ok: false, httpStatus: 401, error: "Signature mismatch." };
  }

  return { ok: true };
}

/**
 * The GET handshake Meta performs once, when the callback URL is saved.
 *
 * Returns the challenge to echo back verbatim as text/plain. Meta requires the
 * bare challenge in the body — a JSON wrapper fails verification with a
 * message that does not say why.
 */
export function verifyMetaVerifyToken(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  expectedToken: string | undefined
): MetaVerifyResult {
  if (!expectedToken) {
    return {
      ok: false,
      httpStatus: 503,
      error: "META_VERIFY_TOKEN is not configured.",
    };
  }

  if (mode !== "subscribe") {
    return { ok: false, httpStatus: 403, error: "Unsupported hub.mode." };
  }

  if (!timingSafeEqual(sha256(token ?? ""), sha256(expectedToken))) {
    return { ok: false, httpStatus: 403, error: "Verify token mismatch." };
  }

  return { ok: true, challenge: challenge ?? "" };
}

/**
 * session.ts — Edge-safe session token helpers (Web Crypto only, no Node imports).
 *
 * Token format (v2): "v2.<jti>.<issuedAtMs>.<expiresAtMs>.<hex-hmac-sha256>"
 * The HMAC is computed over the exact prefix string
 * "v2.<jti>.<issuedAtMs>.<expiresAtMs>" (verbatim, including the "v2." and the dots).
 *
 * The HMAC key is `SESSION_SECRET` — a dedicated, random, 32+ char secret.
 * It is NEVER the dashboard login password. Historically this file signed with
 * DASHBOARD_PASSWORD itself, which meant a leaked cookie was an offline
 * password-cracking oracle (one SHA-256 per guess, no salt, no KDF) — that
 * bug is why SESSION_SECRET exists as a separate, unrelated secret.
 *
 * The old 2-part format ("<expiresAtMs>.<hex-hmac>") is rejected outright with
 * no fallback — there is no code path that verifies a token against the
 * password anymore.
 */

const COOKIE_NAME = "__Host-session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const TOKEN_VERSION = "v2";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares two hex strings of the same expected length.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Public API ────────────────────────────────────────────────────────────────

export { COOKIE_NAME, MAX_AGE_SECONDS };

/**
 * Reads SESSION_SECRET from the environment and validates it is present and
 * strong enough (>= 32 chars). Throws a clear Error otherwise so callers fail
 * loudly rather than silently signing with a weak/missing key.
 */
export function assertSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET environment variable is not set. It must be a random " +
        "string of at least 32 characters, distinct from DASHBOARD_PASSWORD."
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "SESSION_SECRET is too short. It must be at least 32 characters long."
    );
  }
  return secret;
}

/**
 * Creates a signed session token string.
 * Format: "v2.<jti>.<issuedAtMs>.<expiresAtMs>.<hmac-hex>"
 */
export async function createSessionToken(secret: string): Promise<string> {
  const jti = crypto.randomUUID();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + MAX_AGE_SECONDS * 1000;
  const prefix = `${TOKEN_VERSION}.${jti}.${issuedAt}.${expiresAt}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(prefix));
  return `${prefix}.${bufToHex(sig)}`;
}

/**
 * Verifies a session token.
 * Returns true only if the token is exactly the v2 5-part shape, the HMAC is
 * valid, AND the token has not expired. Returns false for any malformed,
 * tampered, expired, or old-format token.
 */
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 5) return false;

  const [version, jti, issuedAtStr, expiresAtStr, providedHex] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!jti) return false;

  const issuedAt = parseInt(issuedAtStr, 10);
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;

  // Recompute the HMAC over the RAW prefix substring taken verbatim from the
  // token — never over a re-serialization of the parsed numbers — so a
  // string like "12abc" for issuedAt/expiresAt can't be silently normalized
  // into a numerically-equal-but-differently-spelled prefix that still
  // passes a re-serialized HMAC check.
  const dotIdx4 = token.lastIndexOf(".");
  const prefix = token.slice(0, dotIdx4);

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(prefix));
  const expectedHex = bufToHex(sig);

  // Compute both checks as separate consts, then AND them — never short-circuit
  // (e.g. `if (!hmacOk) return false; return notExpired;`) — because that shape
  // makes the total time-to-response depend on which check failed, which is
  // exactly the kind of timing signal constant-time comparison is meant to deny
  // an attacker probing for a valid-but-expired vs. invalid-signature token.
  const hmacOk = constantTimeEqual(expectedHex, providedHex);
  const notExpired = expiresAt > Date.now();

  return hmacOk && notExpired;
}

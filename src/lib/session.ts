/**
 * session.ts — Edge-safe session token helpers (Web Crypto only, no Node imports).
 *
 * Token format: "<expiresAtMs>.<hex-hmac-sha256>"
 * The HMAC is keyed by DASHBOARD_PASSWORD and signs the expiresAtMs string.
 */

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ── Internal helpers ──────────────────────────────────────────────────────────

async function importKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(password),
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
 * Creates a signed session token string.
 * Format: "<expiresAtMs>.<hmac-hex>"
 */
export async function createSessionToken(password: string): Promise<string> {
  const expiresAt = String(Date.now() + MAX_AGE_SECONDS * 1000);
  const key = await importKey(password);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expiresAt));
  return `${expiresAt}.${bufToHex(sig)}`;
}

/**
 * Verifies a session token.
 * Returns true only if the HMAC is valid AND the token has not expired.
 * Returns false for any malformed, tampered, or expired token.
 */
export async function verifySessionToken(
  token: string,
  password: string
): Promise<boolean> {
  const dotIdx = token.indexOf(".");
  if (dotIdx === -1) return false;

  const expiresAtStr = token.slice(0, dotIdx);
  const providedHex = token.slice(dotIdx + 1);

  // Validate the expiry field is a valid integer before HMAC check
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return false;

  // Recompute HMAC
  const key = await importKey(password);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expiresAtStr));
  const expectedHex = bufToHex(sig);

  // Constant-time compare first, then expiry — avoids short-circuit timing leak
  const hmacOk = constantTimeEqual(expectedHex, providedHex);
  const notExpired = expiresAt > Date.now();

  return hmacOk && notExpired;
}

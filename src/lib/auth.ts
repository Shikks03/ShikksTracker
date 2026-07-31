import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { COOKIE_NAME, assertSessionSecret, verifySessionToken } from "@/lib/session";

/**
 * Hash a string with SHA-256 so both sides produce equal-length buffers,
 * which is required by timingSafeEqual.
 */
function sha256(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/**
 * Validates the x-cron-secret header against the CRON_SECRET env var
 * using a timing-safe comparison to prevent timing-based secret inference.
 * Returns a NextResponse error (401 or 500) if validation fails, or null
 * if the request is authorised. The sequence engine and other cron-guarded
 * routes reuse this helper.
 */
export function requireCronSecret(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET environment variable is not set." },
      { status: 500 }
    );
  }

  const provided = request.headers.get("x-cron-secret") ?? "";
  const isValid = timingSafeEqual(sha256(provided), sha256(cronSecret));
  if (!isValid) {
    return NextResponse.json(
      { error: "Unauthorized: missing or invalid x-cron-secret header." },
      { status: 401 }
    );
  }

  return null;
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Session-cookie auth guard for API route handlers, mirroring the
 * `requireCronSecret` convention: returns `NextResponse | null`, called as
 * the first statement of a handler, and a non-null result is returned
 * immediately by the caller.
 *
 * WHY THIS EXISTS: src/proxy.ts (Next middleware) was previously the ONLY
 * authorization check standing in front of the entire DB write surface. That
 * is a single point of failure — a matcher typo, a Next middleware CVE, or a
 * path-normalisation bypass in the framework would silently expose every
 * mutating route with nothing behind it. This helper is deliberately
 * redundant with the proxy: defence in depth, not a replacement for it. Every
 * route that calls this remains protected even if the proxy layer is ever
 * misconfigured, skipped, or bypassed.
 *
 * Behaviour:
 *  1. Resolve SESSION_SECRET via assertSessionSecret(). Missing/weak secret
 *     fails closed with 503 (never treated as "no auth required").
 *  2. Read the session cookie. Missing/empty -> 401.
 *  3. Verify the token. Invalid/expired -> 401.
 *  4. For mutating methods (POST/PATCH/PUT/DELETE) only: if an Origin header
 *     is present, it must match this app's own origin. This is a second
 *     layer behind the session cookie's SameSite=Strict attribute — browsers
 *     omit Origin on plenty of legitimate same-origin/non-browser requests,
 *     so its absence is allowed through; its presence-and-mismatch is not.
 *  5. Otherwise return null (authorized).
 */
export async function requireSession(request: NextRequest): Promise<NextResponse | null> {
  let secret: string;
  try {
    secret = assertSessionSecret();
  } catch {
    return NextResponse.json(
      { error: "SESSION_SECRET is not configured." },
      { status: 503 }
    );
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const valid = await verifySessionToken(token, secret);
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      const expected = (process.env.APP_BASE_URL || request.nextUrl.origin).replace(/\/+$/, "");
      const actual = origin.replace(/\/+$/, "");
      if (actual !== expected) {
        return NextResponse.json(
          { error: "Cross-origin request rejected" },
          { status: 403 }
        );
      }
    }
  }

  return null;
}

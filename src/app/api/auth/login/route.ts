import { NextRequest, NextResponse } from "next/server";
import {
  createSessionToken,
  assertSessionSecret,
  COOKIE_NAME,
  MAX_AGE_SECONDS,
} from "@/lib/session";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  getClientIp,
} from "@/lib/loginRateLimit";

/**
 * POST /api/auth/login
 *
 * Body: { password: string }
 *
 * On success: sets a signed HttpOnly session cookie and returns { ok: true }.
 * On failure: returns 401 { error: "Invalid password" }.
 *
 * Rate limited (Mongo-backed, per-IP strict + global loose — see
 * src/lib/loginRateLimit.ts) — locked-out requests get a 429 before the
 * password is even compared. Failures and successes are logged (IP + outcome
 * only, never the attempted password).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "DASHBOARD_PASSWORD is not configured." },
      { status: 503 }
    );
  }

  if (password.length < 12) {
    return NextResponse.json(
      {
        error:
          "DASHBOARD_PASSWORD is too weak (must be at least 12 characters). Fix the configured password before logging in.",
      },
      { status: 503 }
    );
  }

  let sessionSecret: string;
  try {
    sessionSecret = assertSessionSecret();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "SESSION_SECRET is not configured.",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const provided =
    body !== null &&
    typeof body === "object" &&
    "password" in body &&
    typeof (body as Record<string, unknown>).password === "string"
      ? (body as { password: string }).password
      : null;

  if (!provided) {
    return NextResponse.json({ error: "Missing password field." }, { status: 400 });
  }

  const ip = getClientIp(request);

  const { locked, retryAfterSeconds } = await checkLoginRateLimit(ip);
  if (locked) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }

  // Constant-time compare via Web Crypto to avoid timing attacks.
  // We derive an HMAC of the candidate and the real password against a fixed message,
  // then compare — this avoids a char-by-char short-circuit on the raw strings.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("shikkstracker-login-compare"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [hmacProvided, hmacExpected] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(provided)),
    crypto.subtle.sign("HMAC", key, enc.encode(password)),
  ]);

  const a = new Uint8Array(hmacProvided);
  const b = new Uint8Array(hmacExpected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  const passwordMatch = diff === 0;

  if (!passwordMatch) {
    await recordLoginFailure(ip);
    console.warn(`[auth/login] ${new Date().toISOString()} ip=${ip} outcome=failure`);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await clearLoginFailures(ip);
  console.info(`[auth/login] ${new Date().toISOString()} ip=${ip} outcome=success`);

  const token = await createSessionToken(sessionSecret);

  const response = NextResponse.json({ ok: true });
  // __Host- prefix requires: secure=true, path="/", and no Domain attribute.
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

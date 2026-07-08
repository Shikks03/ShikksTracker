import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";

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

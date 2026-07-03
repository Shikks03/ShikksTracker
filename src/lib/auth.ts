import { NextRequest, NextResponse } from "next/server";

/**
 * Validates the x-cron-secret header against the CRON_SECRET env var.
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

  const provided = request.headers.get("x-cron-secret");
  if (provided !== cronSecret) {
    return NextResponse.json(
      { error: "Unauthorized: missing or invalid x-cron-secret header." },
      { status: 401 }
    );
  }

  return null;
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireOsSecret } from "@/lib/auth";
import { parseLimit } from "@/lib/env";
import { buildOsAttention, DEFAULT_ATTENTION_DAYS } from "@/lib/os/attention";

export const dynamic = "force-dynamic";

/** Clamp for ?days= — a year is already far beyond any useful chase window. */
const MAX_ATTENTION_DAYS = 365;

/**
 * GET /api/os/attention — the follow-up chaser's feed (spec §D.2).
 * Query: ?days= (default 3) · ?limit= (default 50, max 200).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireOsSecret(request);
  if (authError) return authError;
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const rawDays = searchParams.get("days");
    const parsedDays = rawDays ? parseInt(rawDays, 10) : NaN;
    const days = Number.isFinite(parsedDays)
      ? Math.min(Math.max(0, parsedDays), MAX_ATTENTION_DAYS)
      : DEFAULT_ATTENTION_DAYS;

    const limit = parseLimit(searchParams, 50, 200);

    return NextResponse.json(await buildOsAttention({ days, limit }));
  } catch (err) {
    return handleError(err);
  }
}

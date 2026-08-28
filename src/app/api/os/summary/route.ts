import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireOsSecret } from "@/lib/auth";
import { parseLimit } from "@/lib/env";
import { buildOsSummary } from "@/lib/os/summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/os/summary — dashboard-grade snapshot for RikuOS (spec §D.2).
 * Guarded by x-os-secret; session-exempt in src/proxy.ts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireOsSecret(request);
  if (authError) return authError;
  try {
    await connectDB();
    // `limit` bounds the campaigns array only — everything else is a scalar
    // count. Defaults per spec §D.1: 50, max 200.
    const limit = parseLimit(request.nextUrl.searchParams, 50, 200);
    return NextResponse.json(await buildOsSummary(limit));
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireOsSecret } from "@/lib/auth";
import { buildOsVariantStats } from "@/lib/os/variantStats";

export const dynamic = "force-dynamic";

/**
 * GET /api/os/variant-stats — per-approach reply rates (spec §D.2).
 *
 * No `limit`: the result set is one row per Variant, a hand-curated collection
 * of a handful of documents, and truncating it would silently hide an approach
 * from the retro agent's comparison.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireOsSecret(request);
  if (authError) return authError;
  try {
    await connectDB();
    return NextResponse.json(await buildOsVariantStats());
  } catch (err) {
    return handleError(err);
  }
}

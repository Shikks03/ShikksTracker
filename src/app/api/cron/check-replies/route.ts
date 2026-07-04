import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { checkReplies } from "@/lib/replies";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
/** Vercel: allow up to 300 s for this route (Pro plan max). */
export const maxDuration = 300;

async function handle(request: NextRequest): Promise<NextResponse> {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    await connectDB();
    const result = await checkReplies();
    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}

export const GET = handle;
export const POST = handle;

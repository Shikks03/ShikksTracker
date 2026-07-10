import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { runSequenceEngine } from "@/lib/sequence";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
/**
 * Vercel maxDuration request (300 s). Deploy target is Hobby, which may cap this
 * to 60 s — that is now fine: with SENDS_PER_RUN=1 (default) and no inter-send
 * sleep in the cron path, a single-send run completes well within 60 s. The
 * value 300 is a harmless ceiling request that Hobby will silently cap; it does
 * not cause errors when the cap is lower.
 */
export const maxDuration = 300;

async function handle(request: NextRequest): Promise<NextResponse> {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    const summary = await runSequenceEngine();
    return NextResponse.json(summary);
  } catch (err) {
    return handleError(err);
  }
}

export const GET = handle;
export const POST = handle;

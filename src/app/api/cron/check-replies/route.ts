import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { checkReplies } from "@/lib/replies";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";
/**
 * Vercel maxDuration request (300 s). Deploy target is Hobby, which may cap this
 * to 60 s — reply polling is a read-only pass over Gmail threads and typically
 * completes in a few seconds per active contact, so the 60 s cap is safe in
 * practice. The value 300 is a harmless ceiling request.
 */
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

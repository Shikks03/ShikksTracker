import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireOsSecret } from "@/lib/auth";
import { createOsDraft, validateOsDraftPayload } from "@/lib/os/drafts";

export const dynamic = "force-dynamic";

/**
 * POST /api/os/drafts — create one approved response draft from a RikuOS queue
 * item (spec §D.2).
 *
 * Body: { contactId, channel, body, subject?, replyToLogId?, variantKey? }
 *
 * Email drafts join the ordinary approved queue and are delivered by the
 * sequence engine's sendApproved() — so the daily cap, the Manila send window
 * and the suppression re-check all still apply, exactly as for any other send.
 * Facebook drafts land in the manual outreach lane for copy-paste sending.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = requireOsSecret(request);
  if (authError) return authError;
  try {
    await connectDB();

    let raw: Record<string, unknown>;
    try {
      raw = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
    }

    const validation = validateOsDraftPayload(raw);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.httpStatus });
    }

    const result = await createOsDraft(validation.payload);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    }

    return NextResponse.json(result.log, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

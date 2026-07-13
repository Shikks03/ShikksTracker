import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { generateTemplateDraft } from "@/lib/draft";

export const dynamic = "force-dynamic";

/**
 * POST /api/templates/generate
 *
 * Body: { brief: string, tone?: string }
 * Returns: { subject, body } — a reusable template with {{...}} tokens.
 * Does NOT persist; the client reviews/edits then POSTs to /api/templates.
 * Session-cookie protected via proxy.ts (logged-in browser action).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { brief?: unknown; tone?: unknown };

    if (typeof body.brief !== "string" || body.brief.trim() === "") {
      return NextResponse.json({ error: "brief is required" }, { status: 400 });
    }
    const tone = typeof body.tone === "string" ? body.tone : undefined;

    const { subject, body: draftBody } = await generateTemplateDraft({
      brief: body.brief.trim(),
      tone,
    });

    return NextResponse.json({ subject, body: draftBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface a missing API key as a clear 400 (mirrors test/generate-draft)
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return handleError(err);
  }
}

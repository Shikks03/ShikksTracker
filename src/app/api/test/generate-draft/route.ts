import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { connectDB } from "@/lib/db";
import { generateEmailDraft, DraftInput } from "@/lib/draft";
import { renderTrackedHtml } from "@/lib/tracking";
import Contact from "@/models/Contact";
import Campaign from "@/models/Campaign";
import EmailLog from "@/models/EmailLog";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Request body shapes
// ---------------------------------------------------------------------------

interface ContactIdBody {
  contactId: string;
  stage: 1 | 2 | 3;
}

interface InlineBody {
  offerSummary: string;
  toneNotes?: string;
  businessName: string;
  contactName?: string;
  keyPoints: string;
  stage: 1 | 2 | 3;
}

type RequestBody = ContactIdBody | InlineBody;

function isContactIdBody(b: RequestBody): b is ContactIdBody {
  return "contactId" in b;
}

function isValidStage(s: unknown): s is 1 | 2 | 3 {
  return s === 1 || s === 2 || s === 3;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * POST /api/test/generate-draft
 *
 * Guards: x-cron-secret header.
 *
 * Option A — DB mode:
 *   { contactId: string, stage: 1|2|3 }
 *   Loads the contact + its campaign, fetches prior EmailLogs for context,
 *   generates a draft WITHOUT saving anything.
 *
 * Option B — Inline mode (no DB needed):
 *   { offerSummary, toneNotes?, businessName, contactName?, keyPoints, stage }
 *   Passes straight through to generateEmailDraft.
 *
 * Returns: { subject: string, body: string, html: string }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.ALLOW_TEST_ROUTES !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    const body: RequestBody = await request.json();

    if (!isValidStage(body.stage)) {
      return NextResponse.json(
        { error: "stage must be 1, 2, or 3" },
        { status: 400 }
      );
    }

    let draftInput: DraftInput;

    if (isContactIdBody(body)) {
      // ---- Option A: load from DB ----
      await connectDB();

      const contact = await Contact.findById(body.contactId).lean();
      if (!contact) {
        return NextResponse.json(
          { error: `Contact not found: ${body.contactId}` },
          { status: 404 }
        );
      }

      const campaign = await Campaign.findById(contact.campaignId).lean();
      if (!campaign) {
        return NextResponse.json(
          { error: `Campaign not found: ${contact.campaignId}` },
          { status: 404 }
        );
      }

      // Fetch prior emails for follow-up continuity (stages < requested, sorted by stage asc)
      const priorLogs = await EmailLog.find({
        contactId: contact._id,
        stage: { $lt: body.stage },
      })
        .sort({ stage: 1 })
        .select({ subject: 1, body: 1, stage: 1 })
        .lean();

      draftInput = {
        offerSummary: campaign.offerSummary,
        toneNotes: campaign.toneNotes ?? "",
        businessName: contact.businessName,
        contactName: contact.contactName,
        keyPoints: contact.keyPoints,
        stage: body.stage,
        previousEmails:
          priorLogs.length > 0
            ? priorLogs.map((l) => ({ subject: l.subject, body: l.body }))
            : undefined,
      };
    } else {
      // ---- Option B: inline / no DB ----
      const inline = body as InlineBody;

      if (!inline.offerSummary || !inline.businessName || !inline.keyPoints) {
        return NextResponse.json(
          {
            error:
              "Inline mode requires offerSummary, businessName, and keyPoints",
          },
          { status: 400 }
        );
      }

      draftInput = {
        offerSummary: inline.offerSummary,
        toneNotes: inline.toneNotes ?? "",
        businessName: inline.businessName,
        contactName: inline.contactName,
        keyPoints: inline.keyPoints,
        stage: inline.stage,
      };
    }

    const { subject, body: plainBody } = await generateEmailDraft(draftInput);

    return NextResponse.json({
      subject,
      body: plainBody,
      // Untracked HTML preview (no links rewritten, no pixel) — same output the
      // former bodyToHtml produced. See tracking.ts renderTrackedHtml.
      html: renderTrackedHtml(plainBody, [], null),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test/generate-draft]", err);

    // Surface API key / config errors as 400 rather than 500 for clarity
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return handleError(err);
  }
}

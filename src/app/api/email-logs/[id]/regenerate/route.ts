import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import Contact from "@/models/Contact";
import Campaign from "@/models/Campaign";
import { generateEmailDraft } from "@/lib/draft";
import { handleError, notFound } from "@/lib/api";
import type { IContact } from "@/models/Contact";
import type { ICampaign } from "@/models/Campaign";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/email-logs/[id]/regenerate
 *
 * Regenerates the AI draft for a single EmailLog that is currently in
 * "draft" status. Updates subject/body in place — keeps status "draft",
 * stage, and all tracking fields untouched.
 *
 * Request body (all optional):
 *   { feedback?: string }
 *
 * Responses:
 *   200  — updated EmailLog doc
 *   400  — status !== "draft", or missing ANTHROPIC_API_KEY
 *   404  — log, contact, or campaign not found
 *   5xx  — unexpected error
 *
 * The route mirrors the DraftInput construction in generateDrafts() in
 * src/lib/sequence.ts so regenerated drafts have identical context to
 * the original (offerSummary, toneNotes, previousEmails from sent logs),
 * plus the current draft's subject/body as previousAttempt and any
 * human feedback from the request body.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    await connectDB();
    const { id } = await params;

    // Load the EmailLog
    const log = await EmailLog.findById(id).lean();
    if (!log) return notFound(id);

    // Only drafts can be regenerated — approved/sending/sent are immutable
    if (log.status !== "draft") {
      return NextResponse.json(
        {
          error: `Only draft logs can be regenerated. This log is '${log.status}'.`,
        },
        { status: 400 }
      );
    }

    // Parse optional feedback from request body
    let feedback: string | undefined;
    try {
      const body = (await request.json()) as Record<string, unknown>;
      if (typeof body.feedback === "string" && body.feedback.trim()) {
        feedback = body.feedback.trim();
      }
    } catch {
      // Empty or missing body — fine, feedback stays undefined
    }

    // Load contact
    const contact = (await Contact.findById(log.contactId).lean()) as IContact | null;
    if (!contact) {
      return NextResponse.json(
        { error: `Contact not found: ${String(log.contactId)}` },
        { status: 404 }
      );
    }

    // Load campaign
    const campaign = (await Campaign.findById(log.campaignId).lean()) as ICampaign | null;
    if (!campaign) {
      return NextResponse.json(
        { error: `Campaign not found: ${String(log.campaignId)}` },
        { status: 404 }
      );
    }

    // Gather previous SENT logs for continuity context (same as generateDrafts)
    const previousLogs = await EmailLog.find({
      contactId: contact._id,
      stage: { $lt: log.stage },
      status: "sent",
    })
      .sort({ stage: 1 })
      .select({ subject: 1, body: 1 })
      .lean();

    const previousEmails = previousLogs.map((l) => ({
      subject: l.subject,
      body: l.body,
    }));

    // Generate a new draft via Claude, passing the current draft as
    // previousAttempt so Claude knows what not to repeat.
    let newDraft: { subject: string; body: string };
    try {
      newDraft = await generateEmailDraft({
        offerSummary: campaign.offerSummary,
        toneNotes: campaign.toneNotes,
        businessName: contact.businessName,
        contactName: contact.contactName,
        keyPoints: contact.keyPoints,
        stage: log.stage as 1 | 2 | 3,
        previousEmails: previousEmails.length ? previousEmails : undefined,
        previousAttempt: { subject: log.subject, body: log.body },
        feedback,
        // Without this, a facebook/instagram/phone draft would silently
        // regenerate through the EMAIL system prompt (complete with a
        // subject line) — generateEmailDraft defaults to "email" when
        // channel is omitted. log.channel is always set (schema default
        // "email"), so this is safe for legacy logs too.
        channel: log.channel,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ANTHROPIC_API_KEY")) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw err;
    }

    // Update the log's subject/body in place — status stays "draft".
    // For a non-email log, newDraft.subject is "" (generateEmailDraft never
    // returns a subject for facebook/instagram/phone — see draft.ts). That's
    // safe to write here: log.channel is not changing, EmailLogSchema only
    // *requires* subject when channel === "email" (a non-email log's subject
    // was already ""), so this never blanks out a real subject line.
    const updated = await EmailLog.findByIdAndUpdate(
      id,
      { subject: newDraft.subject, body: newDraft.body },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) return notFound(id);

    return NextResponse.json(updated);
  } catch (err) {
    return handleError(err);
  }
}

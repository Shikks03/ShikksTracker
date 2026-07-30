import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { isSubjectRequiredForChannel } from "@/lib/outreachLogs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const contactId = searchParams.get("contactId");
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");
    const channel = searchParams.get("channel");

    if (contactId) filter.contactId = contactId;
    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;
    // Additive, optional filter (Phase 4 multi-channel): the email review
    // queue (/review) now passes channel=email so social/phone drafts don't
    // leak into the email-only review UI. Deliberately NOT defaulted to
    // "email" here — the contact-detail page calls this same endpoint with
    // only `contactId` and must keep showing that contact's full history
    // across every channel.
    if (channel) filter.channel = channel;

    const logs = await EmailLog.find(filter).lean();
    return NextResponse.json(logs);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { contactId, stage, subject, body: emailBody } = body;

    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (stage !== 1 && stage !== 2 && stage !== 3) {
      return NextResponse.json({ error: "stage must be 1, 2, or 3" }, { status: 400 });
    }
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const contact = await Contact.findById(contactId).lean();
    if (!contact) {
      return NextResponse.json({ error: `Contact not found: ${contactId}` }, { status: 404 });
    }

    // Legacy contacts saved before outreachChannel existed fall back to
    // "email" — same convention as isNonEmailChannel/EMAIL_CHANNEL_QUERY.
    const channel = contact.outreachChannel ?? "email";

    // The channel isn't known until the contact loads, so this check can't
    // run alongside the contactId/stage/body checks above. Facebook/
    // Instagram DMs and phone scripts have no subject line — the EmailLog
    // schema itself only requires `subject` when channel === "email".
    if (
      isSubjectRequiredForChannel(channel) &&
      (!subject || typeof subject !== "string" || !subject.trim())
    ) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }

    const existing = await EmailLog.findOne({
      contactId: contact._id,
      stage,
      // "sending" is included: a log mid-send must not be replaced by a manual compose
      status: { $in: ["approved", "sending", "sent"] },
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: `An approved, sending, or sent log already exists for this contact at stage ${stage as number}` },
        { status: 409 }
      );
    }

    const log = await EmailLog.create({
      contactId: contact._id,
      campaignId: contact.campaignId,
      stage,
      subject: typeof subject === "string" ? subject.trim() : "",
      body: (emailBody as string).trim(),
      status: "approved",
      channel,
    });

    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

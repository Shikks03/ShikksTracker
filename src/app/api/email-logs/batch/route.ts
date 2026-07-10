import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { applyPlaceholders } from "@/lib/compose";

export const dynamic = "force-dynamic";

interface SkippedItem {
  businessName: string;
  reason: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { contactIds, subject, body: emailBody } = body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json(
        { error: "contactIds must be a non-empty array" },
        { status: 400 }
      );
    }
    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const subjectTemplate = (subject as string).trim();
    const bodyTemplate = (emailBody as string).trim();

    let created = 0;
    const skipped: SkippedItem[] = [];

    for (const id of contactIds) {
      try {
        const contact = await Contact.findById(id as string).lean();
        if (!contact) {
          skipped.push({ businessName: String(id), reason: "contact not found" });
          continue;
        }

        if (contact.status !== "active") {
          skipped.push({
            businessName: contact.businessName,
            reason: `contact is ${contact.status}`,
          });
          continue;
        }

        const stage = (contact.currentStage + 1) as 1 | 2 | 3;
        if (contact.currentStage >= 3) {
          skipped.push({
            businessName: contact.businessName,
            reason: "sequence already complete",
          });
          continue;
        }

        const existing = await EmailLog.findOne({
          contactId: contact._id,
          stage,
          // "sending" is included: a log mid-send must not be replaced by a batch compose
          status: { $in: ["approved", "sending", "sent"] },
        }).lean();
        if (existing) {
          skipped.push({
            businessName: contact.businessName,
            reason: `already has a stage ${stage} email`,
          });
          continue;
        }

        const placeholderContact = {
          businessName: contact.businessName,
          contactName: contact.contactName,
        };

        await EmailLog.create({
          contactId: contact._id,
          campaignId: contact.campaignId,
          stage,
          subject: applyPlaceholders(subjectTemplate, placeholderContact),
          body: applyPlaceholders(bodyTemplate, placeholderContact),
          status: "approved",
        });

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ businessName: String(id), reason: msg });
      }
    }

    return NextResponse.json({ created, skipped });
  } catch (err) {
    return handleError(err);
  }
}

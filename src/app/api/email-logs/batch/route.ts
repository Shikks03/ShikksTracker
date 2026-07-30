import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { isSubjectRequiredForChannels } from "@/lib/outreachLogs";
import { isValidObjectId } from "mongoose";

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
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const subjectTrimmed = typeof subject === "string" ? subject.trim() : "";
    const bodyTemplate = (emailBody as string).trim();

    // Single pre-load instead of a per-contact findById in the loop below:
    // removes the N+1 and gives us every selected contact's channel up front,
    // which the subject requirement (a property of the whole batch, not a
    // single contact) needs before the loop can run.
    //
    // Only well-formed ObjectIds go into the $in: an unparseable id would make
    // the whole query throw a CastError, which handleError turns into a 400 for
    // the ENTIRE batch. Before the pre-load this route did findById per contact
    // inside the per-contact try/catch, so one malformed id only cost that one
    // contact. Filtering here preserves that: a malformed id simply misses the
    // map and is reported as "contact not found" alongside the others.
    const validIds = (contactIds as unknown[]).filter(
      (id): id is string => typeof id === "string" && isValidObjectId(id)
    );
    const contacts = await Contact.find({ _id: { $in: validIds } }).lean();
    const contactsById = new Map(contacts.map((c) => [String(c._id), c]));

    // A subject is required iff at least one resolved contact is on the
    // email channel (legacy null/undefined channel counts as email — see
    // isSubjectRequiredForChannel). Contacts that don't resolve to a real
    // document are reported via `skipped` in the loop below and don't
    // factor into this decision.
    const resolvedChannels = contactIds
      .map((id) => contactsById.get(String(id)))
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => c.outreachChannel);
    if (isSubjectRequiredForChannels(resolvedChannels) && !subjectTrimmed) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }

    const subjectTemplate = subjectTrimmed;

    let created = 0;
    const skipped: SkippedItem[] = [];

    for (const id of contactIds) {
      try {
        const contact = contactsById.get(String(id));
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

        // Store the template text verbatim — placeholder substitution
        // ({{businessName}}, {{contactName}}) happens at send time inside
        // sendOneLog, which is the single documented substitution path.
        // Substituting here and again at send time would double-substitute
        // and would also substitute before threading logic can update the subject.
        await EmailLog.create({
          contactId: contact._id,
          campaignId: contact.campaignId,
          stage,
          subject: subjectTemplate,
          body: bodyTemplate,
          status: "approved",
          // Legacy contacts saved before outreachChannel existed fall back
          // to "email" — same convention as isNonEmailChannel/EMAIL_CHANNEL_QUERY.
          channel: contact.outreachChannel ?? "email",
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

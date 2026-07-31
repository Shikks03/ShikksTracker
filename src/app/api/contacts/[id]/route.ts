import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError, notFound } from "@/lib/api";
import { suppressContact } from "@/lib/contacts";
import { asObjectIdString, badRequest } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const NEXT_ACTION_NOTE_MAX_LENGTH = 500;

const UPDATABLE_FIELDS = [
  "contactName",
  "keyPoints",
  "status",
  "pipelineStage",
  "nextSendAt",
  "businessName",
  "nextActionAt",
  "nextActionNote",
] as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid contact id");
    await connectDB();
    const contact = await Contact.findById(validId).lean();
    if (!contact) return notFound(id);
    return NextResponse.json(contact);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid contact id");
    await connectDB();
    const body = await request.json() as Record<string, unknown>;

    const incomingStatus = body.status as string | undefined;
    const isSuppressStatus =
      incomingStatus === "unsubscribed" || incomingStatus === "bounced";

    if (isSuppressStatus) {
      // For suppression-triggering status changes, run the shared helper first.
      // This upserts the Suppression entry, sets status + nextSendAt: null, and
      // deletes pending draft/approved logs. We pass reason = incomingStatus
      // which is narrowed to "unsubscribed" | "bounced" here.
      const reason = incomingStatus as "unsubscribed" | "bounced";
      await suppressContact(validId, reason);

      // Apply any OTHER updatable fields from the same PATCH (e.g. keyPoints,
      // businessName). Exclude "status" — suppressContact already wrote it —
      // and "nextSendAt" — suppressContact always nulls it, so we never let a
      // caller override that from a suppression PATCH.
      const otherUpdate: Record<string, unknown> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (field === "status" || field === "nextSendAt") continue;
        if (field in body) otherUpdate[field] = body[field];
      }
      if (Object.keys(otherUpdate).length > 0) {
        await Contact.findByIdAndUpdate(validId, otherUpdate, { runValidators: true });
      }

      // Return the final contact state (fresh read so all fields are current)
      const updated = await Contact.findById(validId).lean();
      if (!updated) return notFound(id);
      return NextResponse.json(updated);
    }

    // Validate nextActionAt — must cast to a valid Date or be null
    if ("nextActionAt" in body) {
      const raw = body.nextActionAt;
      if (raw !== null && raw !== undefined) {
        const d = new Date(raw as string | number);
        if (isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "nextActionAt must be a valid date string or null" },
            { status: 400 }
          );
        }
      }
    }

    // Validate nextActionNote — max 500 chars
    if ("nextActionNote" in body) {
      const note = body.nextActionNote;
      if (note !== null && note !== undefined) {
        if (typeof note !== "string") {
          return NextResponse.json(
            { error: "nextActionNote must be a string or null" },
            { status: 400 }
          );
        }
        if (note.length > NEXT_ACTION_NOTE_MAX_LENGTH) {
          return NextResponse.json(
            { error: `nextActionNote must be ${NEXT_ACTION_NOTE_MAX_LENGTH} characters or fewer` },
            { status: 400 }
          );
        }
      }
    }

    // Non-suppression status changes (and all other field updates) — original path
    const update: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) update[field] = body[field];
    }

    const contact = await Contact.findByIdAndUpdate(validId, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!contact) return notFound(id);
    return NextResponse.json(contact);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid contact id");
    await connectDB();
    const contact = await Contact.findByIdAndDelete(validId).lean();
    if (!contact) return notFound(id);
    const { deletedCount } = await EmailLog.deleteMany({ contactId: validId });
    return NextResponse.json({ deleted: true, logsDeleted: deletedCount ?? 0 });
  } catch (err) {
    return handleError(err);
  }
}

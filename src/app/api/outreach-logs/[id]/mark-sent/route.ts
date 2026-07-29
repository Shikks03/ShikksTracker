import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import Contact from "@/models/Contact";
import { handleError, notFound } from "@/lib/api";
import { advanceContactAfterSend } from "@/lib/sequence";
import { checkMarkSentAllowed, NON_EMAIL_CHANNEL_QUERY } from "@/lib/outreachLogs";
import type { IEmailLog } from "@/models/EmailLog";
import type { IContact } from "@/models/Contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/outreach-logs/[id]/mark-sent
 *
 * Records that the human sent this facebook/instagram/phone message by hand
 * on that platform. Never touches Gmail — this is the manual counterpart to
 * sendOneLog() in src/lib/sequence.ts, which handles the email channel only.
 *
 * Order of operations (all before advancing contact state, so a double-click
 * can never advance currentStage twice):
 *   1. Load the log — 404 if missing.
 *   2. Guard: reject channel "email" (400) and already "sent"/"sending" (409)
 *      — see checkMarkSentAllowed in src/lib/outreachLogs.ts.
 *   3. Atomically claim draft/approved → sent (findOneAndUpdate with the
 *      current status as a precondition, mirroring sendOneLog's
 *      approved → "sending" claim). A null result means another request won
 *      the race — 409.
 *   4. Load the contact; advance its stage/pipeline/nextSendAt via the SAME
 *      advanceContactAfterSend() sendOneLog uses for Gmail sends, so cron and
 *      manual-mark-sent can never diverge in how they advance a contact.
 *   5. If the contact is gone (orphaned log), the mark-sent itself still
 *      stands — reverting it would just move the double-processing risk
 *      elsewhere — but we report the situation instead of silently returning
 *      as if nothing were wrong.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    await connectDB();
    const { id } = await params;

    const log = await EmailLog.findById(id).lean();
    if (!log) return notFound(id);

    const guard = checkMarkSentAllowed({ channel: log.channel, status: log.status });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.httpStatus });
    }

    // Atomic claim: draft/approved -> sent. The status precondition in the
    // filter is what makes this safe under a double-click / concurrent
    // request — only the first request to reach Mongo gets `claimed` back
    // non-null. NON_EMAIL_CHANNEL_QUERY is defense-in-depth on top of the
    // guard above (channel never changes after creation, so this can't race,
    // but it costs nothing and keeps the invariant enforced at the write
    // itself). Deliberately NOT `channel: { $ne: "email" }` — that would also
    // match a legacy log with no channel field at all, which is an email log
    // in disguise (see NON_EMAIL_CHANNEL_QUERY's doc comment).
    const now = new Date();
    const claimed = (await EmailLog.findOneAndUpdate(
      { _id: id, status: { $in: ["draft", "approved"] }, ...NON_EMAIL_CHANNEL_QUERY },
      { status: "sent", sentAt: now, sentManuallyAt: now },
      { new: true }
    )) as IEmailLog | null;

    if (!claimed) {
      return NextResponse.json(
        { error: "This log was already claimed by another request (already sent or sending)." },
        { status: 409 }
      );
    }

    const contact = (await Contact.findById(claimed.contactId).lean()) as IContact | null;
    if (!contact) {
      // The log is now correctly marked "sent" — that record must stand.
      // There is simply no contact left to advance state on.
      return NextResponse.json(
        {
          log: claimed,
          contact: null,
          error: `Log marked sent, but its contact (${String(claimed.contactId)}) no longer exists — stage/pipeline could not be advanced.`,
        },
        { status: 200 }
      );
    }

    await advanceContactAfterSend(contact, claimed, now);

    const updatedContact = await Contact.findById(claimed.contactId).lean();

    return NextResponse.json({ log: claimed, contact: updatedContact });
  } catch (err) {
    return handleError(err);
  }
}

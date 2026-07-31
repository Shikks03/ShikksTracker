import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import Contact from "@/models/Contact";
import { handleError, notFound } from "@/lib/api";
import { advanceContactAfterSend } from "@/lib/sequence";
import { checkMarkSentAllowed, NON_EMAIL_CHANNEL_QUERY } from "@/lib/outreachLogs";
import type { IEmailLog } from "@/models/EmailLog";
import type { IContact } from "@/models/Contact";
import { asObjectIdString, badRequest } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/outreach-logs/[id]/mark-sent
 *
 * Records that the human sent this facebook/instagram/phone message by hand
 * on that platform. Never touches Gmail — this is the manual counterpart to
 * sendOneLog() in src/lib/sequence.ts, which handles the email channel only.
 *
 * Order of operations:
 *   1. Load the log — 404 if missing.
 *   2. Load the contact (needed by the guard below to tell a genuine
 *      double-click apart from a repairable stranded contact).
 *   3. Guard via checkMarkSentAllowed (src/lib/outreachLogs.ts): reject
 *      channel "email" (400) and "sending" (409); for "draft"/"approved"
 *      returns `mode: "claim"`; for "sent" it returns `mode: "repair"` when
 *      the contact's currentStage is still behind this log's stage (a PRIOR
 *      request's claim succeeded but a failure afterward — e.g. a transient
 *      Mongo error — meant advanceContactAfterSend never ran, stranding the
 *      contact permanently since retrying used to hit this same 409 forever),
 *      or 409 when the contact has already been advanced past this stage
 *      (the genuine double-click case).
 *   4. `mode: "claim"` — atomically claim draft/approved → sent
 *      (findOneAndUpdate with the current status as a precondition,
 *      mirroring sendOneLog's approved → "sending" claim). A null result
 *      means another request won the race — 409.
 *      `mode: "repair"` — the log is already "sent"; skip the claim (it's
 *      already claimed) and use the existing log/sentAt as-is.
 *   5. Advance the contact's stage/pipeline/nextSendAt via the SAME
 *      advanceContactAfterSend() sendOneLog uses for Gmail sends, so cron and
 *      manual-mark-sent can never diverge in how they advance a contact.
 *      advanceContactAfterSend's own monotonic guard (currentStage < log.stage)
 *      makes this safe to call again in the repair case even under a race
 *      with another request — it will simply no-op if something else already
 *      advanced the contact in the meantime.
 *   6. If the contact is gone (orphaned log), the mark-sent itself still
 *      stands — reverting it would just move the double-processing risk
 *      elsewhere — but we report the situation instead of silently returning
 *      as if nothing were wrong.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid email log id");
    await connectDB();

    const log = await EmailLog.findById(validId).lean();
    if (!log) return notFound(id);

    const contact = (await Contact.findById(log.contactId).lean()) as IContact | null;

    // A missing contact can never be "repaired" — there's nothing to advance —
    // so pass +Infinity to guarantee the guard falls through to the ordinary
    // 409 (matching the pre-existing behaviour for an orphaned "sent" log)
    // rather than incorrectly entering repair mode.
    const guard = checkMarkSentAllowed({
      channel: log.channel,
      status: log.status,
      contactCurrentStage: contact ? contact.currentStage : Number.POSITIVE_INFINITY,
      logStage: log.stage,
    });
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.httpStatus });
    }

    let claimed: IEmailLog;
    let sentAtForAdvance: Date;

    if (guard.mode === "repair") {
      // Already claimed by a prior request — do not re-claim, just repair
      // the stranded contact state using the log's existing sentAt.
      claimed = log as unknown as IEmailLog;
      sentAtForAdvance = log.sentAt ?? new Date();
    } else {
      // Atomic claim: draft/approved -> sent. The status precondition in the
      // filter is what makes this safe under a double-click / concurrent
      // request — only the first request to reach Mongo gets `claimedDoc`
      // back non-null. NON_EMAIL_CHANNEL_QUERY is defense-in-depth on top of
      // the guard above (channel never changes after creation, so this can't
      // race, but it costs nothing and keeps the invariant enforced at the
      // write itself). Deliberately NOT `channel: { $ne: "email" }` — that
      // would also match a legacy log with no channel field at all, which is
      // an email log in disguise (see NON_EMAIL_CHANNEL_QUERY's doc comment).
      const now = new Date();
      const claimedDoc = (await EmailLog.findOneAndUpdate(
        { _id: validId, status: { $in: ["draft", "approved"] }, ...NON_EMAIL_CHANNEL_QUERY },
        { status: "sent", sentAt: now, sentManuallyAt: now },
        { new: true }
      )) as IEmailLog | null;

      if (!claimedDoc) {
        return NextResponse.json(
          { error: "This log was already claimed by another request (already sent or sending)." },
          { status: 409 }
        );
      }

      claimed = claimedDoc;
      sentAtForAdvance = now;
    }

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

    await advanceContactAfterSend(contact, claimed, sentAtForAdvance);

    const updatedContact = await Contact.findById(claimed.contactId).lean();

    return NextResponse.json({ log: claimed, contact: updatedContact });
  } catch (err) {
    return handleError(err);
  }
}

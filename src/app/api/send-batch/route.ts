import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError, toClientMessage } from "@/lib/api";
import { getManilaDayStart, sendOneLog, EMAIL_CHANNEL_QUERY } from "@/lib/sequence";
import { envInt } from "@/lib/env";
import { asObjectIdString } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DAILY_SEND_CAP  = envInt("DAILY_SEND_CAP",  15);
const SEND_BATCH_MAX  = envInt("SEND_BATCH_MAX",   5);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { ids: rawIds } = body;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json(
        { error: "ids must be a non-empty array" },
        { status: 400 }
      );
    }

    // Elements were previously unvalidated `unknown` reaching a Mongo `$in`
    // filter — filter to well-formed ObjectId strings only (same pattern as
    // email-logs/batch/route.ts's isValidObjectId filter).
    const ids = rawIds.filter(
      (id): id is string => asObjectIdString(id) !== null
    );
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "ids must contain at least one valid id" },
        { status: 400 }
      );
    }

    if (ids.length > SEND_BATCH_MAX) {
      return NextResponse.json(
        { error: `Batch too large: max ${SEND_BATCH_MAX} per request`, max: SEND_BATCH_MAX },
        { status: 400 }
      );
    }

    // Daily cap check. DAILY_SEND_CAP is a Gmail deliverability/warm-up
    // budget — it must count only Gmail-sent (email-channel) logs. Manually
    // marked-sent facebook/instagram/phone logs cost the sender's Gmail
    // reputation nothing and must not eat into this budget, or marking a
    // batch of social touches "sent" would silently block email sending for
    // the rest of the Manila day. EMAIL_CHANNEL_QUERY matches this fix
    // already made in sendApproved() (src/lib/sequence.ts) so both stay in
    // lockstep.
    const now = new Date();
    const dayStart = getManilaDayStart(now);
    const sentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
      ...EMAIL_CHANNEL_QUERY,
    });
    const capRemaining = DAILY_SEND_CAP - sentToday;

    if (capRemaining <= 0) {
      return NextResponse.json(
        { error: "Daily cap reached", cap: DAILY_SEND_CAP },
        { status: 429 }
      );
    }

    // Load only approved logs, capped at remaining daily allowance.
    // EMAIL_CHANNEL_QUERY excludes facebook/instagram/phone logs from this
    // query (matches only channel:"email" or a legacy channel-less log) so a
    // non-email id mixed into the request can't consume a slot in
    // capRemaining ahead of a real email log — sendOneLog would refuse to
    // Gmail-send it anyway (see its isNonEmailChannel guard), but by then the
    // .limit() cutoff may already have pushed a legitimate email log outside
    // the batch, silently dropping it from both `results` and the send.
    const logs = await EmailLog.find({
      _id: { $in: ids },
      status: "approved",
      ...EMAIL_CHANNEL_QUERY,
    }).limit(capRemaining);

    const results: {
      id: string;
      contactName: string;
      subject: string;
      status: "sent" | "failed" | "skipped";
      error?: string;
    }[] = [];

    for (const log of logs) {
      const logResult = await sendOneLog(log);
      results.push({
        id: String(log._id),
        contactName: logResult.contactName,
        subject: logResult.subject,
        status: logResult.status,
        // sendOneLog's `error` field can carry a raw Gmail/driver error
        // message (e.g. on bounce or a non-bounce Gmail failure) — sequence.ts
        // is out of scope here, so sanitize at this route boundary via
        // toClientMessage rather than echoing driver text to the client. The
        // real message is still logged server-side by toClientMessage.
        ...(logResult.error ? { error: toClientMessage(new Error(logResult.error)) } : {}),
      });
    }

    const newSentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
      ...EMAIL_CHANNEL_QUERY,
    });

    return NextResponse.json({
      results,
      capRemaining: Math.max(0, DAILY_SEND_CAP - newSentToday),
    });
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { getManilaDayStart, sendOneLog } from "@/lib/sequence";

export const dynamic = "force-dynamic";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DAILY_SEND_CAP  = envInt("DAILY_SEND_CAP",  15);
const SEND_BATCH_MAX  = envInt("SEND_BATCH_MAX",   5);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids must be a non-empty array" },
        { status: 400 }
      );
    }

    if (ids.length > SEND_BATCH_MAX) {
      return NextResponse.json(
        { error: `Batch too large: max ${SEND_BATCH_MAX} per request`, max: SEND_BATCH_MAX },
        { status: 400 }
      );
    }

    // Daily cap check
    const now = new Date();
    const dayStart = getManilaDayStart(now);
    const sentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
    });
    const capRemaining = DAILY_SEND_CAP - sentToday;

    if (capRemaining <= 0) {
      return NextResponse.json(
        { error: "Daily cap reached", cap: DAILY_SEND_CAP },
        { status: 429 }
      );
    }

    // Load only approved logs, capped at remaining daily allowance
    const logs = await EmailLog.find({
      _id: { $in: ids },
      status: "approved",
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
        ...(logResult.error ? { error: logResult.error } : {}),
      });
    }

    const newSentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
    });

    return NextResponse.json({
      results,
      capRemaining: Math.max(0, DAILY_SEND_CAP - newSentToday),
    });
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import mongoose from "mongoose";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const PIPELINE_STAGES = [
  "not_started",
  "contacted",
  "replied",
  "call_booked",
  "proposal_sent",
  "won",
  "lost",
] as const;

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;

    // Validate id before using in aggregation (and before connectDB — a
    // malformed id should cost no DB round trip).
    if (!mongoose.isValidObjectId(id)) {
      return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    }
    await connectDB();
    const campaignObjId = new mongoose.Types.ObjectId(id);

    // Funnel: contacts in this campaign that have >=1 sent log (sent), opened, clicked, replied
    const funnelResult = await EmailLog.aggregate([
      { $match: { campaignId: campaignObjId } },
      {
        $group: {
          _id: "$contactId",
          hasSent: { $max: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
          hasOpened: { $max: { $cond: [{ $gt: ["$openCount", 0] }, 1, 0] } },
          hasClicked: { $max: { $cond: [{ $gt: ["$clickCount", 0] }, 1, 0] } },
          hasReplied: { $max: { $cond: [{ $eq: ["$replied", true] }, 1, 0] } },
        },
      },
      {
        $group: {
          _id: null,
          sent: { $sum: "$hasSent" },
          opened: { $sum: "$hasOpened" },
          clicked: { $sum: "$hasClicked" },
          replied: { $sum: "$hasReplied" },
        },
      },
    ]);

    const funnel = funnelResult[0]
      ? {
          sent: funnelResult[0].sent as number,
          opened: funnelResult[0].opened as number,
          clicked: funnelResult[0].clicked as number,
          replied: funnelResult[0].replied as number,
        }
      : { sent: 0, opened: 0, clicked: 0, replied: 0 };

    // Pipeline: count contacts by pipelineStage for this campaign
    const pipelineResult = await Contact.aggregate([
      { $match: { campaignId: campaignObjId } },
      { $group: { _id: "$pipelineStage", count: { $sum: 1 } } },
    ]);

    const pipeline: Record<string, number> = Object.fromEntries(
      PIPELINE_STAGES.map((s) => [s, 0])
    );
    for (const row of pipelineResult) {
      if (typeof row._id === "string" && row._id in pipeline) {
        pipeline[row._id] = row.count as number;
      }
    }

    return NextResponse.json({ funnel, pipeline });
  } catch (err) {
    return handleError(err);
  }
}

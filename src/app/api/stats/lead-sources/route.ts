import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { handleError } from "@/lib/api";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();

    const rows = await Contact.aggregate([
      {
        $group: {
          _id: "$leadSource",
          total: { $sum: 1 },
          contacted: {
            $sum: {
              $cond: [{ $ne: ["$pipelineStage", "not_started"] }, 1, 0],
            },
          },
          replied: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$pipelineStage",
                    ["replied", "call_booked", "proposal_sent", "won"],
                  ],
                },
                1,
                0,
              ],
            },
          },
          won: {
            $sum: {
              $cond: [{ $eq: ["$pipelineStage", "won"] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = rows.map((r) => {
      const total = r.total as number;
      const contacted = r.contacted as number;
      const replied = r.replied as number;
      const won = r.won as number;
      return {
        leadSource: r._id as string,
        total,
        contacted,
        replied,
        won,
        replyRate: contacted > 0 ? replied / contacted : 0,
        winRate: contacted > 0 ? won / contacted : 0,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { handleError } from "@/lib/api";
import { createContactChecked, CreateContactInput } from "@/lib/contacts";

export const dynamic = "force-dynamic";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const HOT_LEAD_THRESHOLD = envInt("HOT_LEAD_THRESHOLD", 5);

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");
    const pipelineStage = searchParams.get("pipelineStage");
    const leadSource = searchParams.get("leadSource");
    const sort = searchParams.get("sort");
    const hot = searchParams.get("hot");
    const stats = searchParams.get("stats");

    if (campaignId) {
      // Cast explicitly: aggregation $match (stats=true path) bypasses
      // Mongoose's string→ObjectId casting, unlike find().
      if (!mongoose.isValidObjectId(campaignId)) {
        return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
      }
      filter.campaignId = new mongoose.Types.ObjectId(campaignId);
    }
    if (status) filter.status = status;
    if (pipelineStage) filter.pipelineStage = pipelineStage;
    if (leadSource) filter.leadSource = leadSource;
    if (hot === "true") filter.engagementScore = { $gte: HOT_LEAD_THRESHOLD };

    if (stats === "true") {
      // Aggregation: join with emaillogs to compute per-contact stats
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipeline: any[] = [
        { $match: filter },
        { $sort: sort === "score" ? { engagementScore: -1 } : { createdAt: -1 } },
        {
          $lookup: {
            from: "emaillogs",
            localField: "_id",
            foreignField: "contactId",
            as: "logs",
          },
        },
        {
          $addFields: {
            lastSentAt: {
              $max: {
                $map: {
                  input: {
                    $filter: {
                      input: "$logs",
                      as: "l",
                      cond: { $eq: ["$$l.status", "sent"] },
                    },
                  },
                  as: "sl",
                  in: "$$sl.sentAt",
                },
              },
            },
            opened: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$logs",
                      as: "l",
                      cond: { $gt: ["$$l.openCount", 0] },
                    },
                  },
                },
                0,
              ],
            },
            clicked: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$logs",
                      as: "l",
                      cond: { $gt: ["$$l.clickCount", 0] },
                    },
                  },
                },
                0,
              ],
            },
            replied: {
              $gt: [
                {
                  $size: {
                    $filter: {
                      input: "$logs",
                      as: "l",
                      cond: { $eq: ["$$l.replied", true] },
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $unset: "logs" },
      ];

      const contacts = await Contact.aggregate(pipeline);
      return NextResponse.json(contacts);
    }

    // Plain path (no stats)
    let query = Contact.find(filter);
    if (sort === "score") {
      query = query.sort({ engagementScore: -1 });
    }
    const contacts = await query.lean();
    return NextResponse.json(contacts);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateContactInput;
    const result = await createContactChecked(body, "manual");

    switch (result.outcome) {
      case "invalid":
        return NextResponse.json({ error: result.reason }, { status: 400 });
      case "suppressed":
        return NextResponse.json(
          { error: "Email is suppressed", reason: result.reason },
          { status: 422 }
        );
      case "duplicate":
        return NextResponse.json(
          { error: "Duplicate: resource already exists" },
          { status: 409 }
        );
      case "inserted":
        return NextResponse.json(result.contact, { status: 201 });
    }
  } catch (err) {
    return handleError(err);
  }
}

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

    // Valid enum values from Contact schema — used for whitelist validation below.
    // Invalid query-string values are silently ignored (same semantics as the
    // find() path, which passes them through Mongoose and gets an empty result;
    // ignoring is safer and consistent with how the plain path behaves in practice).
    const VALID_STATUS = new Set(["active", "paused", "replied", "bounced", "unsubscribed"]);
    const VALID_PIPELINE_STAGE = new Set([
      "not_started", "contacted", "replied", "call_booked",
      "proposal_sent", "won", "lost",
    ]);
    const VALID_LEAD_SOURCE = new Set(["cold_email", "referral", "event_connection", "other"]);

    if (campaignId) {
      // Cast explicitly: aggregation $match (stats=true path) bypasses
      // Mongoose's string→ObjectId casting, unlike find().
      if (!mongoose.isValidObjectId(campaignId)) {
        return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
      }
      filter.campaignId = new mongoose.Types.ObjectId(campaignId);
    }
    if (status && VALID_STATUS.has(status)) filter.status = status;
    if (pipelineStage && VALID_PIPELINE_STAGE.has(pipelineStage)) filter.pipelineStage = pipelineStage;
    if (leadSource && VALID_LEAD_SOURCE.has(leadSource)) filter.leadSource = leadSource;
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
            // Max repliedAt across logs where replied === true
            repliedAt: {
              $max: {
                $map: {
                  input: {
                    $filter: {
                      input: "$logs",
                      as: "l",
                      cond: { $eq: ["$$l.replied", true] },
                    },
                  },
                  as: "rl",
                  in: "$$rl.repliedAt",
                },
              },
            },
            // replySnippet from the most-recent replied log (by repliedAt)
            replySnippet: {
              $let: {
                vars: {
                  topReplied: {
                    $first: {
                      $sortArray: {
                        input: {
                          $filter: {
                            input: "$logs",
                            as: "l",
                            cond: { $eq: ["$$l.replied", true] },
                          },
                        },
                        sortBy: { repliedAt: -1 },
                      },
                    },
                  },
                },
                in: "$$topReplied.replySnippet",
              },
            },
            // Highest-stage log (any status) — kept as temp field, unset below
            lastLog: {
              $first: {
                $sortArray: {
                  input: "$logs",
                  sortBy: { stage: -1 },
                },
              },
            },
          },
        },
        // Extract scalars from the temp lastLog document
        {
          $addFields: {
            lastLogStage: "$lastLog.stage",
            lastLogStatus: "$lastLog.status",
          },
        },
        { $unset: ["logs", "lastLog"] },
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

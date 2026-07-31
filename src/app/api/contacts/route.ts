import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { handleError } from "@/lib/api";
import { createContactChecked, CreateContactInput } from "@/lib/contacts";
import { envInt, parseLimit, parseOffset } from "@/lib/env";
import { asObjectIdString, asOptionalString, asString } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const HOT_LEAD_THRESHOLD = envInt("HOT_LEAD_THRESHOLD", 5);

const VALID_LEAD_SOURCE_INPUT = new Set(["cold_email", "referral", "event_connection", "other"]);
const VALID_OUTREACH_CHANNEL_INPUT = new Set(["email", "facebook", "instagram", "phone"]);

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
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
          // security-phase-2 (Wave C): sub-pipeline form instead of a plain
          // localField/foreignField lookup. The plain form materialises the
          // FULL log document — every `subject`, `body`, `replyBody` — for
          // every contact before the $unset near the bottom discards it; as
          // the log collection grows this risks the 16 MB per-document BSON
          // limit or the 100 MB blocking-stage memory limit. Only the fields
          // the stages below actually read are projected:
          //   status, sentAt   -> lastSentAt (filters status:"sent", maps sentAt)
          //   openCount        -> opened
          //   clickCount       -> clicked
          //   replied          -> replied / repliedAt / replySnippet filters
          //   repliedAt        -> repliedAt / replySnippet sort key
          //   replySnippet     -> replySnippet value
          //   stage            -> lastLog sort key (then lastLogStage)
          //   status (again)   -> lastLogStatus (via lastLog)
          // Every field referenced by any $addFields stage below is kept;
          // nothing else from EmailLog is needed here.
          $lookup: {
            from: "emaillogs",
            let: { contactId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$contactId", "$$contactId"] } } },
              {
                $project: {
                  _id: 0,
                  status: 1,
                  sentAt: 1,
                  openCount: 1,
                  clickCount: 1,
                  replied: 1,
                  repliedAt: 1,
                  replySnippet: 1,
                  stage: 1,
                },
              },
            ],
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
    // Bounded (security-phase-2, Wave C): with no query params this previously
    // returned the entire contacts collection. Default cap is deliberately
    // high (1000) so no existing caller — which today expects "everything" —
    // silently loses rows; it only guards against unbounded growth.
    const limit = parseLimit(searchParams, 1000, 5000);
    const offset = parseOffset(searchParams, 100_000);
    let query = Contact.find(filter);
    if (sort === "score") {
      query = query.sort({ engagementScore: -1 });
    }
    const contacts = await query.skip(offset).limit(limit).lean();
    return NextResponse.json(contacts);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const rawBody = (await request.json()) as Record<string, unknown>;

    // `request.json() as CreateContactInput` is a compile-time-only cast —
    // it performs zero runtime validation, so an unvalidated field (e.g.
    // campaignId as `{"$ne": null}`) would otherwise flow straight into
    // createContactChecked. Build an explicitly whitelisted, type-checked
    // input object instead. createContactChecked re-validates defensively
    // too (belt and suspenders), but the route boundary is where a clean
    // 400 belongs.
    const campaignId = asObjectIdString(rawBody.campaignId);
    if (campaignId === null) {
      return NextResponse.json({ error: "Invalid or missing campaignId" }, { status: 400 });
    }
    const businessName = asString(rawBody.businessName, 200);
    if (businessName === null) {
      return NextResponse.json({ error: "Invalid or missing businessName" }, { status: 400 });
    }
    const keyPoints = asString(rawBody.keyPoints, 5000);
    if (keyPoints === null) {
      return NextResponse.json({ error: "Invalid or missing keyPoints" }, { status: 400 });
    }

    let leadSource: CreateContactInput["leadSource"];
    if (rawBody.leadSource !== undefined) {
      if (typeof rawBody.leadSource !== "string" || !VALID_LEAD_SOURCE_INPUT.has(rawBody.leadSource)) {
        return NextResponse.json({ error: "Invalid leadSource" }, { status: 400 });
      }
      leadSource = rawBody.leadSource as CreateContactInput["leadSource"];
    }

    let outreachChannel: CreateContactInput["outreachChannel"];
    if (rawBody.outreachChannel !== undefined) {
      if (
        typeof rawBody.outreachChannel !== "string" ||
        !VALID_OUTREACH_CHANNEL_INPUT.has(rawBody.outreachChannel)
      ) {
        return NextResponse.json({ error: "Invalid outreachChannel" }, { status: 400 });
      }
      outreachChannel = rawBody.outreachChannel as CreateContactInput["outreachChannel"];
    }

    let recentReviewDays: number | undefined;
    // 0 is a valid, meaningful day count (reviewed today) and is falsy —
    // explicit `!== undefined` check, not truthiness (documented invariant).
    if (rawBody.recentReviewDays !== undefined) {
      const v = rawBody.recentReviewDays;
      if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        return NextResponse.json({ error: "Invalid recentReviewDays" }, { status: 400 });
      }
      recentReviewDays = v;
    }

    const body: CreateContactInput = {
      campaignId,
      businessName,
      keyPoints,
      contactEmail: asOptionalString(rawBody.contactEmail, 320),
      contactName: asOptionalString(rawBody.contactName, 200),
      phone: asOptionalString(rawBody.phone, 50),
      facebook: asOptionalString(rawBody.facebook, 500),
      instagram: asOptionalString(rawBody.instagram, 500),
      website: asOptionalString(rawBody.website, 500),
      sourcePlaceId: asOptionalString(rawBody.sourcePlaceId, 200),
      webPresenceTier: asOptionalString(rawBody.webPresenceTier, 50),
      claimed: asOptionalString(rawBody.claimed, 50),
      ...(leadSource !== undefined ? { leadSource } : {}),
      ...(outreachChannel !== undefined ? { outreachChannel } : {}),
      ...(recentReviewDays !== undefined ? { recentReviewDays } : {}),
    };

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

/**
 * summary.ts — GET /api/os/summary (spec §D.2).
 *
 * CONTRACT SURFACE (spec §D.3): the OsSummary shape below is consumed by
 * ../RikuOS. Changing it obliges a matching edit to ../RikuOS/ARCHITECTURE.md
 * §4.1 in the same breath.
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Campaign from "@/models/Campaign";
import CronRun from "@/models/CronRun";
import { envInt } from "@/lib/env";

// Mirrors src/app/api/contacts/route.ts, which reads the same variable for its
// ?hot=true filter. Both must agree on what "hot" means.
const HOT_LEAD_THRESHOLD = envInt("HOT_LEAD_THRESHOLD", 5);

const PIPELINE_STAGES = [
  "not_started",
  "contacted",
  "replied",
  "call_booked",
  "proposal_sent",
  "won",
  "lost",
] as const;

export interface OsCampaignSummary {
  id: string;
  name: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export interface OsSummary {
  contacts: { total: number; byPipelineStage: Record<string, number>; hot: number };
  queue: { drafts: number; approved: number };
  campaigns: OsCampaignSummary[];
  engine: { lastRunAt: string | null; lastRunErrors: number };
}

/**
 * Builds the dashboard-grade snapshot.
 *
 * The `messenger` block was REMOVED on 2026-09-05 (decision S15) together with
 * the inbound Messenger lane. Do not add it back: the Meta app stays in
 * Development mode permanently, so no prospect message can ever reach this app,
 * and any counter derived from one would be structurally empty rather than
 * merely zero. It was removed only after RikuOS deleted its consumer, because
 * a MISSING block read as `null` there and `null` was its "webhook never fired"
 * alarm — see the S15 note in docs/os-api.md for that ordering trap.
 */
export async function buildOsSummary(campaignLimit: number): Promise<OsSummary> {
  const [total, hot, pipelineRows, drafts, approved, lastRun] =
    await Promise.all([
      Contact.countDocuments({}),
      Contact.countDocuments({ engagementScore: { $gte: HOT_LEAD_THRESHOLD } }),
      Contact.aggregate<{ _id: string; count: number }>([
        { $group: { _id: "$pipelineStage", count: { $sum: 1 } } },
      ]),
      EmailLog.countDocuments({ status: "draft" }),
      EmailLog.countDocuments({ status: "approved" }),
      CronRun.findOne({}).sort({ startedAt: -1 }).select({ startedAt: 1, errorCount: 1 }).lean(),
    ]);

  const byPipelineStage: Record<string, number> = Object.fromEntries(
    PIPELINE_STAGES.map((s) => [s, 0])
  );
  for (const row of pipelineRows) {
    if (typeof row._id === "string" && row._id in byPipelineStage) {
      byPipelineStage[row._id] = row.count;
    }
  }

  // Per-campaign funnel. Same semantics as GET /api/campaigns/[id]/stats —
  // counts CONTACTS with at least one sent/opened/clicked/replied log, not raw
  // log counts — so the two surfaces can never disagree about a number the user
  // sees in both places. Grouped by (campaign, contact) first, then by campaign.
  const funnelRows = await EmailLog.aggregate<{
    _id: unknown;
    sent: number;
    opened: number;
    clicked: number;
    replied: number;
  }>([
    {
      $group: {
        _id: { campaignId: "$campaignId", contactId: "$contactId" },
        hasSent: { $max: { $cond: [{ $eq: ["$status", "sent"] }, 1, 0] } },
        hasOpened: { $max: { $cond: [{ $gt: ["$openCount", 0] }, 1, 0] } },
        hasClicked: { $max: { $cond: [{ $gt: ["$clickCount", 0] }, 1, 0] } },
        hasReplied: { $max: { $cond: [{ $eq: ["$replied", true] }, 1, 0] } },
      },
    },
    {
      $group: {
        _id: "$_id.campaignId",
        sent: { $sum: "$hasSent" },
        opened: { $sum: "$hasOpened" },
        clicked: { $sum: "$hasClicked" },
        replied: { $sum: "$hasReplied" },
      },
    },
  ]);

  const funnelById = new Map(funnelRows.map((r) => [String(r._id), r]));

  const campaignDocs = await Campaign.find({})
    .sort({ createdAt: -1 })
    .limit(campaignLimit)
    .select({ name: 1 })
    .lean();

  const campaigns: OsCampaignSummary[] = campaignDocs.map((c) => {
    const f = funnelById.get(String(c._id));
    return {
      id: String(c._id),
      name: c.name,
      sent: f?.sent ?? 0,
      opened: f?.opened ?? 0,
      clicked: f?.clicked ?? 0,
      replied: f?.replied ?? 0,
    };
  });

  return {
    contacts: { total, byPipelineStage, hot },
    queue: { drafts, approved },
    campaigns,
    engine: {
      lastRunAt: lastRun?.startedAt ? new Date(lastRun.startedAt).toISOString() : null,
      lastRunErrors: lastRun?.errorCount ?? 0,
    },
  };
}

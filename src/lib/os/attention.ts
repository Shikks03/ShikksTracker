/**
 * attention.ts — GET /api/os/attention (spec §D.2), the follow-up chaser's feed.
 *
 * CONTRACT SURFACE (spec §D.3): the item shapes below are consumed by
 * ../RikuOS. Changing them obliges a matching edit to
 * ../RikuOS/ARCHITECTURE.md §4.1 in the same breath.
 *
 * Design note: every item must carry enough context for RikuOS to draft a reply
 * WITHOUT a second call — hence keyPoints, the campaign's offerSummary/toneNotes
 * and the last outbound body travel inline.
 */

import mongoose from "mongoose";
import Contact, { IContact } from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Campaign from "@/models/Campaign";
import { envInt } from "@/lib/env";
import { truncateWithEllipsis } from "@/lib/os/text";

/** Cap on the outbound body carried inline as drafting context. */
export const OS_BODY_MAX_LEN = 2000;

/** Default staleness window for repliedUnanswered, overridable via ?days=. */
export const DEFAULT_ATTENTION_DAYS = 3;

// Mirrors src/app/api/contacts/route.ts — both must agree on what "hot" means.
const HOT_LEAD_THRESHOLD = envInt("HOT_LEAD_THRESHOLD", 5);

// --- Structural input shapes -------------------------------------------------
// Deliberately structural (not the Mongoose interfaces) so `.lean()` results and
// hand-written test fixtures both satisfy them without casting.

export interface AttentionContactLike {
  _id: unknown;
  businessName: string;
  contactName?: string | null;
  outreachChannel?: string | null;
  keyPoints: string;
  campaignId: unknown;
  status: string;
  currentStage: number;
  engagementScore: number;
}

export interface AttentionLogLike {
  _id: unknown;
  contactId: unknown;
  stage: number;
  status: string;
  replied?: boolean | null;
  repliedAt?: Date | null;
  replySnippet?: string | null;
  body: string;
  sentAt?: Date | null;
}

export interface AttentionCampaignLike {
  _id: unknown;
  offerSummary: string;
  toneNotes: string;
}

// --- Output shapes -----------------------------------------------------------

export interface RepliedUnansweredItem {
  contactId: string;
  businessName: string;
  contactName: string | null;
  channel: string;
  repliedAt: string;
  replySnippet: string | null;
  lastOutboundBody: string | null;
  keyPoints: string;
  offerSummary: string | null;
  toneNotes: string | null;
  stage: number;
  replyToLogId: string;
}

export interface HotLeadItem {
  contactId: string;
  businessName: string;
  channel: string;
  engagementScore: number;
  pipelineStage: string;
  currentStage: number;
}

export interface OverdueActionItem {
  contactId: string;
  businessName: string;
  nextActionAt: string;
  nextActionNote: string | null;
}

export interface OsAttention {
  repliedUnanswered: RepliedUnansweredItem[];
  hotLeads: HotLeadItem[];
  overdueActions: OverdueActionItem[];
}

// --- Pure query builders (shape-asserted in tests) ---------------------------

/**
 * Hot leads: engaged but not yet in conversation. Replied contacts are excluded
 * because they belong to `repliedUnanswered` — a reply is worth +10 score, so
 * without this every replied contact would also be a "hot lead" and RikuOS
 * would propose two different actions for the same person. Unsubscribed and
 * bounced are excluded because they are not contactable at all.
 */
export function buildHotLeadQuery(
  threshold: number
): { engagementScore: { $gte: number }; status: { $nin: IContact["status"][] } } {
  return {
    engagementScore: { $gte: threshold },
    status: { $nin: ["replied", "unsubscribed", "bounced"] },
  };
}

/**
 * Overdue human-scheduled actions. `$ne: null` is required alongside `$lt`:
 * in MongoDB a null field compares as less-than a date, so `$lt` alone would
 * match every contact that has no action scheduled. The same pairing is used in
 * sendActionReminders (src/lib/sequence.ts).
 */
export function buildOverdueActionQuery(now: Date) {
  return { nextActionAt: { $lt: now, $ne: null } };
}

// --- The selector ------------------------------------------------------------

/**
 * Picks the contacts that replied and have been left hanging.
 *
 * A contact qualifies when ALL of these hold:
 *   1. `status === "replied"`.
 *   2. No pending `draft`/`approved` log — a response is already queued,
 *      including one RikuOS itself created on an earlier pass. This is what
 *      stops the chaser proposing the same follow-up on every poll.
 *   3. It has at least one `replied` log; the NEWEST one is the message we owe
 *      an answer to, and its `_id` becomes `replyToLogId`.
 *   4. That reply is older than `days`.
 *   5. There is no `sent` log dated after that reply — that would mean we have
 *      already answered.
 *
 * Note on (5): `sentAt` is set for manual social/phone sends too (the mark-sent
 * route writes both `sentAt` and `sentManuallyAt`), so this test is correct on
 * every channel, not just email.
 */
export function selectRepliedUnanswered(
  contacts: AttentionContactLike[],
  logsByContactId: Map<string, AttentionLogLike[]>,
  campaignsById: Map<string, AttentionCampaignLike>,
  now: Date,
  days: number
): RepliedUnansweredItem[] {
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const items: RepliedUnansweredItem[] = [];

  for (const contact of contacts) {
    if (contact.status !== "replied") continue;

    const logs = logsByContactId.get(String(contact._id)) ?? [];

    if (logs.some((l) => l.status === "draft" || l.status === "approved")) continue;

    const repliedLogs = logs.filter(
      (l) => l.replied === true && l.repliedAt instanceof Date
    );
    if (repliedLogs.length === 0) continue;

    const newestReplied = repliedLogs.reduce((a, b) =>
      (b.repliedAt as Date).getTime() > (a.repliedAt as Date).getTime() ? b : a
    );
    const repliedAt = newestReplied.repliedAt as Date;

    if (repliedAt.getTime() > cutoffMs) continue;

    const sentLogs = logs.filter((l) => l.status === "sent" && l.sentAt instanceof Date);
    if (sentLogs.some((l) => (l.sentAt as Date).getTime() > repliedAt.getTime())) continue;

    const lastOutbound = sentLogs.reduce<AttentionLogLike | null>(
      (best, l) =>
        best === null || (l.sentAt as Date).getTime() > (best.sentAt as Date).getTime()
          ? l
          : best,
      null
    );

    const campaign = campaignsById.get(String(contact.campaignId)) ?? null;

    items.push({
      contactId: String(contact._id),
      businessName: contact.businessName,
      contactName: contact.contactName ?? null,
      // Legacy contacts predate outreachChannel — treat as email, the same
      // convention as isNonEmailChannel / EMAIL_CHANNEL_QUERY.
      channel: contact.outreachChannel ?? "email",
      repliedAt: repliedAt.toISOString(),
      replySnippet: newestReplied.replySnippet ?? null,
      lastOutboundBody: lastOutbound
        ? truncateWithEllipsis(lastOutbound.body, OS_BODY_MAX_LEN)
        : null,
      keyPoints: contact.keyPoints,
      offerSummary: campaign?.offerSummary ?? null,
      toneNotes: campaign?.toneNotes ?? null,
      stage: newestReplied.stage,
      replyToLogId: String(newestReplied._id),
    });
  }

  return items;
}

// --- The loader --------------------------------------------------------------

/**
 * Loads the three feeds. Deliberately two queries for repliedUnanswered (bounded
 * contacts, then all their logs in one $in) rather than a per-contact loop —
 * every decision then happens in the pure selector above, which is why it can be
 * unit-tested at all.
 */
export async function buildOsAttention(params: {
  days: number;
  limit: number;
  now?: Date;
}): Promise<OsAttention> {
  const now = params.now ?? new Date();

  const repliedContacts = (await Contact.find({ status: "replied" })
    .sort({ _id: 1 })
    .limit(params.limit)
    .lean()) as unknown as AttentionContactLike[];

  let repliedUnanswered: RepliedUnansweredItem[] = [];
  if (repliedContacts.length > 0) {
    // Cast needed: `_id` on the structural AttentionContactLike is `unknown`
    // (deliberately, so lean() results and test fixtures both satisfy it
    // without casting elsewhere) — Mongoose's $in overload rejects unknown[].
    // The lean-query's actual _id values are real ObjectIds at runtime.
    const contactIds = repliedContacts.map((c) => c._id) as mongoose.Types.ObjectId[];
    const logs = (await EmailLog.find({ contactId: { $in: contactIds } })
      .select({
        contactId: 1,
        stage: 1,
        status: 1,
        replied: 1,
        repliedAt: 1,
        replySnippet: 1,
        body: 1,
        sentAt: 1,
      })
      .lean()) as unknown as AttentionLogLike[];

    const logsByContactId = new Map<string, AttentionLogLike[]>();
    for (const log of logs) {
      const key = String(log.contactId);
      const bucket = logsByContactId.get(key);
      if (bucket) bucket.push(log);
      else logsByContactId.set(key, [log]);
    }

    const campaignIds = [...new Set(repliedContacts.map((c) => String(c.campaignId)))];
    const campaignDocs = (await Campaign.find({ _id: { $in: campaignIds } })
      .select({ offerSummary: 1, toneNotes: 1 })
      .lean()) as unknown as AttentionCampaignLike[];
    const campaignsById = new Map(campaignDocs.map((c) => [String(c._id), c]));

    repliedUnanswered = selectRepliedUnanswered(
      repliedContacts,
      logsByContactId,
      campaignsById,
      now,
      params.days
    );
  }

  const hotDocs = await Contact.find(buildHotLeadQuery(HOT_LEAD_THRESHOLD))
    .sort({ engagementScore: -1 })
    .limit(params.limit)
    .select({ businessName: 1, outreachChannel: 1, engagementScore: 1, pipelineStage: 1, currentStage: 1 })
    .lean();

  const hotLeads: HotLeadItem[] = hotDocs.map((c) => ({
    contactId: String(c._id),
    businessName: c.businessName,
    channel: c.outreachChannel ?? "email",
    engagementScore: c.engagementScore,
    pipelineStage: c.pipelineStage,
    currentStage: c.currentStage,
  }));

  const overdueDocs = await Contact.find(buildOverdueActionQuery(now))
    .sort({ nextActionAt: 1 })
    .limit(params.limit)
    .select({ businessName: 1, nextActionAt: 1, nextActionNote: 1 })
    .lean();

  const overdueActions: OverdueActionItem[] = overdueDocs.map((c) => ({
    contactId: String(c._id),
    businessName: c.businessName,
    nextActionAt: new Date(c.nextActionAt as Date).toISOString(),
    nextActionNote: c.nextActionNote ?? null,
  }));

  return { repliedUnanswered, hotLeads, overdueActions };
}

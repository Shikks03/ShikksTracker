import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handleError } from "@/lib/api";
import { parseLimit, parseOffset } from "@/lib/env";
import MessengerConversation from "@/models/MessengerConversation";
import MessengerMessage from "@/models/MessengerMessage";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { rankLinkSuggestions } from "@/lib/messenger/linking";
import type { LinkCandidate, LinkSuggestion } from "@/lib/messenger/linking";

export const dynamic = "force-dynamic";

/**
 * GET /api/messenger/conversations
 *
 * Query params:
 *   count=true        -> { count: <unansweredCount> } only. Feeds the sidebar
 *                         badge (src/components/Sidebar.tsx), mirroring the
 *                         `?count=true` pattern in GET /api/email-logs.
 *   includeIgnored     optional, default false — "ignored" conversations are
 *                       excluded from the ordinary list (they've been marked
 *                       not-a-lead) unless explicitly asked for.
 *   limit / offset      bounded pagination (src/lib/env.ts), same convention
 *                       as every other list route in this app.
 *
 * Ordering: unlinked first, then linked, then (if included) ignored; within
 * each bucket, newest lastInboundAt first. Plain field ordering can't express
 * this (linkStatus sorts alphabetically as ignored < linked < unlinked, which
 * is backwards from what triage needs), so this uses a short aggregation
 * pipeline with a computed sort rank instead of .find().sort().
 *
 * PERFORMANCE: link suggestions are built with exactly ONE Contact query and
 * ONE batched EmailLog aggregation for the whole page — never per
 * conversation. See buildLinkCandidates() below. rankLinkSuggestions (pure,
 * src/lib/messenger/linking.ts) then runs in memory once per unlinked
 * conversation in the current page.
 */

/**
 * Facebook-channel contacts considered as link candidates. A single-user
 * tool's contact list is small; this only guards against unbounded growth,
 * matching the parseLimit/parseOffset convention used across list routes —
 * it is not expected to ever bind in practice.
 */
const MAX_LINK_CANDIDATES = 2000;

const LIST_DEFAULT_LIMIT = 200;
const LIST_MAX_LIMIT = 2000;
const THREAD_PREVIEW_MAX_OFFSET = 100_000;

interface ConversationRow {
  _id: Types.ObjectId;
  psid: string;
  displayName: string;
  contactId: Types.ObjectId | null;
  linkStatus: "unlinked" | "linked" | "ignored";
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
}

/**
 * Unanswered = their last message is newer than ours, or we never replied at
 * all. Mirrors the `unansweredCount` predicate in src/lib/os/summary.ts
 * (Task 9) field-for-field — that file is sibling-owned in this phase, so the
 * two are kept in sync by hand rather than sharing a helper. If one changes,
 * the other must too.
 */
function isUnanswered(lastInboundAt: Date | null, lastOutboundAt: Date | null): boolean {
  if (!lastInboundAt) return false;
  if (!lastOutboundAt) return true;
  return lastInboundAt.getTime() > lastOutboundAt.getTime();
}

/** Same shape as the `count=true` badge query — see isUnanswered's doc comment. */
const UNANSWERED_COUNT_FILTER = {
  linkStatus: { $ne: "ignored" as const },
  lastInboundAt: { $ne: null },
  $or: [{ lastOutboundAt: null }, { $expr: { $gt: ["$lastInboundAt", "$lastOutboundAt"] } }],
};

/**
 * Builds every unlinked conversation's suggestion candidates in exactly two
 * queries total (not two per conversation): one Contact query for every
 * facebook-channel contact, and one batched EmailLog aggregation deriving
 * hasSentFacebookLog / hasReplied for all of them at once.
 */
async function buildLinkCandidates(): Promise<LinkCandidate[]> {
  const contacts = await Contact.find({ outreachChannel: "facebook" })
    .select({ businessName: 1, contactName: 1 })
    .limit(MAX_LINK_CANDIDATES)
    .lean();

  if (contacts.length === 0) return [];

  const contactIds = contacts.map((c) => c._id);

  const stats = await EmailLog.aggregate<{ _id: Types.ObjectId; hasReplied: number }>([
    { $match: { channel: "facebook", status: "sent", contactId: { $in: contactIds } } },
    {
      $group: {
        _id: "$contactId",
        hasReplied: { $max: { $cond: [{ $eq: ["$replied", true] }, 1, 0] } },
      },
    },
  ]);
  const statsById = new Map(stats.map((s) => [String(s._id), s.hasReplied === 1]));

  return contacts.map((c) => ({
    _id: String(c._id),
    businessName: c.businessName,
    contactName: c.contactName ?? null,
    hasSentFacebookLog: statsById.has(String(c._id)),
    hasReplied: statsById.get(String(c._id)) ?? false,
  }));
}

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    if (searchParams.get("count") === "true") {
      const count = await MessengerConversation.countDocuments(UNANSWERED_COUNT_FILTER);
      return NextResponse.json({ count });
    }

    const includeIgnored = searchParams.get("includeIgnored") === "true";
    const limit = parseLimit(searchParams, LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
    const offset = parseOffset(searchParams, THREAD_PREVIEW_MAX_OFFSET);

    const match: Record<string, unknown> = includeIgnored ? {} : { linkStatus: { $ne: "ignored" } };

    const conversations = await MessengerConversation.aggregate<ConversationRow>([
      { $match: match },
      {
        $addFields: {
          _sortRank: {
            $switch: {
              branches: [
                { case: { $eq: ["$linkStatus", "unlinked"] }, then: 0 },
                { case: { $eq: ["$linkStatus", "linked"] }, then: 1 },
              ],
              default: 2,
            },
          },
        },
      },
      { $sort: { _sortRank: 1, lastInboundAt: -1 } },
      { $skip: offset },
      { $limit: limit },
    ]);

    if (conversations.length === 0) {
      return NextResponse.json([]);
    }

    const conversationIds = conversations.map((c) => c._id);
    const hasUnlinked = conversations.some((c) => c.linkStatus === "unlinked");

    const [lastMessages, candidates] = await Promise.all([
      // Newest message per conversation, one query for the whole page — the
      // list-preview text. sentAt is indexed per {conversationId, sentAt: -1}
      // (MessengerMessage schema), so $sort inside the group is index-backed.
      MessengerMessage.aggregate<{ _id: Types.ObjectId; text: string }>([
        { $match: { conversationId: { $in: conversationIds } } },
        { $sort: { sentAt: -1 } },
        { $group: { _id: "$conversationId", text: { $first: "$text" } } },
      ]),
      hasUnlinked ? buildLinkCandidates() : Promise.resolve<LinkCandidate[]>([]),
    ]);
    const lastMessageById = new Map(lastMessages.map((m) => [String(m._id), m.text]));

    const linkedContactIds = conversations
      .filter((c): c is ConversationRow & { contactId: Types.ObjectId } => c.contactId !== null)
      .map((c) => c.contactId);

    const linkedContacts = linkedContactIds.length
      ? await Contact.find({ _id: { $in: linkedContactIds } })
          .select({ businessName: 1, contactName: 1, pipelineStage: 1, currentStage: 1 })
          .lean()
      : [];
    const contactById = new Map(linkedContacts.map((c) => [String(c._id), c]));

    const items = conversations.map((conv) => {
      const contact = conv.contactId ? contactById.get(String(conv.contactId)) ?? null : null;
      const suggestions: LinkSuggestion[] =
        conv.linkStatus === "unlinked" ? rankLinkSuggestions(conv.displayName, candidates) : [];

      return {
        _id: String(conv._id),
        psid: conv.psid,
        displayName: conv.displayName,
        linkStatus: conv.linkStatus,
        lastInboundAt: conv.lastInboundAt ? new Date(conv.lastInboundAt).toISOString() : null,
        lastOutboundAt: conv.lastOutboundAt ? new Date(conv.lastOutboundAt).toISOString() : null,
        unanswered: isUnanswered(
          conv.lastInboundAt ? new Date(conv.lastInboundAt) : null,
          conv.lastOutboundAt ? new Date(conv.lastOutboundAt) : null
        ),
        contact: contact
          ? {
              _id: String(contact._id),
              businessName: contact.businessName,
              contactName: contact.contactName ?? null,
              pipelineStage: contact.pipelineStage,
              currentStage: contact.currentStage,
            }
          : null,
        suggestions,
        lastMessageText: lastMessageById.get(String(conv._id)) ?? "",
      };
    });

    return NextResponse.json(items);
  } catch (err) {
    return handleError(err);
  }
}

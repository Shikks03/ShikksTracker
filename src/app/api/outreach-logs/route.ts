import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import Contact from "@/models/Contact";
import { handleError } from "@/lib/api";
import {
  NON_EMAIL_CHANNEL_QUERY,
  isNonEmailChannel,
  resolveOutreachLogStatusFilter,
} from "@/lib/outreachLogs";

export const dynamic = "force-dynamic";

/**
 * GET /api/outreach-logs
 *
 * Lists non-email (facebook/instagram/phone) EmailLogs for the manual
 * "Outreach Tasks" board, with the owning contact joined in so the UI can
 * render a contact link/summary without an N+1 query per row.
 *
 * Query params:
 *   status     optional — one of draft/approved/sending/sent. When omitted,
 *              defaults to BOTH "draft" and "approved" (see
 *              resolveOutreachLogStatusFilter / DEFAULT_OUTREACH_LOG_STATUSES
 *              in src/lib/outreachLogs.ts): the review-before-send gate that
 *              distinguishes those two statuses only matters for the
 *              automated Gmail path — a facebook/instagram/phone touch is
 *              sent by hand regardless of which of the two it's in, so the
 *              board must show both or a composed-and-approved social
 *              message would never appear. Supplying `?status=` explicitly
 *              still matches that single status exactly, unchanged.
 *   channel    optional — one of facebook/instagram/phone (narrows further
 *              than the baseline non-email filter)
 *   campaignId optional — scope to one campaign
 *
 * Never returns email-channel logs, including legacy logs written before the
 * `channel` field existed (those are email logs in disguise — see
 * NON_EMAIL_CHANNEL_QUERY for why `$ne: "email"` would be wrong here).
 *
 * Logs whose contact no longer exists are dropped rather than returned with
 * `contact: null` — the board has nothing useful to render for them.
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const statusParam = searchParams.get("status");
    const channel = searchParams.get("channel");
    const campaignId = searchParams.get("campaignId");

    const statusResult = resolveOutreachLogStatusFilter(statusParam);
    if (!statusResult.ok) {
      return NextResponse.json({ error: statusResult.error }, { status: statusResult.httpStatus });
    }

    if (channel && !isNonEmailChannel(channel)) {
      return NextResponse.json(
        { error: `Invalid channel: ${channel}. Must be one of: facebook, instagram, phone.` },
        { status: 400 }
      );
    }

    const filter: Record<string, unknown> = { ...statusResult.filter };
    // A specific channel narrows the match to exactly that value; otherwise
    // fall back to the baseline "any non-email channel" predicate. Both
    // branches exclude email (and legacy channel-less) logs.
    if (channel) {
      filter.channel = channel;
    } else {
      Object.assign(filter, NON_EMAIL_CHANNEL_QUERY);
    }
    if (campaignId) filter.campaignId = campaignId;

    // Newest first. EmailLog only has `createdAt` for docs written after
    // 2026-07-11 (Task 5.2); older docs lack the field entirely, and Mongo
    // sorts a missing field as the lowest possible value under a -1 sort —
    // so they naturally fall after every doc that does have createdAt, then
    // break ties among themselves via _id descending (documented fallback).
    const logs = await EmailLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    if (logs.length === 0) {
      return NextResponse.json([]);
    }

    // Batched contact join — one query for all logs, not one per log.
    const contactIds = [...new Set(logs.map((log) => String(log.contactId)))];
    const contacts = await Contact.find({ _id: { $in: contactIds } })
      .select({
        businessName: 1,
        contactName: 1,
        outreachChannel: 1,
        phone: 1,
        facebook: 1,
        instagram: 1,
        website: 1,
        webPresenceTier: 1,
        claimed: 1,
        keyPoints: 1,
        pipelineStage: 1,
        currentStage: 1,
      })
      .lean();
    const contactById = new Map(contacts.map((c) => [String(c._id), c]));

    const items = logs
      .map((log) => {
        const contact = contactById.get(String(log.contactId));
        if (!contact) return null; // orphaned log — drop rather than return contact: null
        return {
          _id: log._id,
          stage: log.stage,
          status: log.status,
          channel: log.channel,
          subject: log.subject,
          body: log.body,
          createdAt: log.createdAt ?? null,
          contact: {
            _id: contact._id,
            businessName: contact.businessName,
            contactName: contact.contactName ?? null,
            outreachChannel: contact.outreachChannel,
            phone: contact.phone ?? null,
            facebook: contact.facebook ?? null,
            instagram: contact.instagram ?? null,
            website: contact.website ?? null,
            webPresenceTier: contact.webPresenceTier ?? null,
            claimed: contact.claimed ?? null,
            keyPoints: contact.keyPoints,
            pipelineStage: contact.pipelineStage,
            currentStage: contact.currentStage,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return NextResponse.json(items);
  } catch (err) {
    return handleError(err);
  }
}

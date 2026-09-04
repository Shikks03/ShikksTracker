import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { handleError, notFound } from "@/lib/api";
import { asObjectIdString, badRequest } from "@/lib/validate";
import MessengerConversation from "@/models/MessengerConversation";
import MessengerMessage from "@/models/MessengerMessage";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { applyReplyEffects } from "@/lib/replyEffects";
import { pickReplyAnchor } from "@/lib/messenger/linking";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Thread view caps at 200 messages (spec's stated cap) — a manual-triage
 *  page, not an infinite-scroll inbox; nothing here paginates further. */
const MAX_THREAD_MESSAGES = 200;

const VALID_ACTIONS = new Set(["link", "ignore", "unlink"]);

// ---------------------------------------------------------------------------
// GET — thread view: conversation + messages + joined contact + draft lane
// ---------------------------------------------------------------------------

/**
 * GET /api/messenger/conversations/[id]
 *
 * Returns the conversation, its messages ascending by sentAt (capped at
 * MAX_THREAD_MESSAGES), the joined Contact (null if unlinked), and the
 * contact's pending facebook draft/approved EmailLogs for the draft lane
 * (also [] if unlinked — there is nothing to attribute a draft to yet).
 */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid conversation id");
    await connectDB();

    const conversation = await MessengerConversation.findById(validId).lean();
    if (!conversation) return notFound(id);

    const messages = await MessengerMessage.find({ conversationId: validId })
      .sort({ sentAt: 1 })
      .limit(MAX_THREAD_MESSAGES)
      .lean();

    const contact = conversation.contactId
      ? await Contact.findById(conversation.contactId)
          .select({
            businessName: 1,
            contactName: 1,
            pipelineStage: 1,
            currentStage: 1,
            outreachChannel: 1,
          })
          .lean()
      : null;

    const draftLogs = conversation.contactId
      ? await EmailLog.find({
          contactId: conversation.contactId,
          channel: "facebook",
          status: { $in: ["draft", "approved"] },
        })
          .sort({ stage: 1, createdAt: -1 })
          .lean()
      : [];

    return NextResponse.json({
      conversation: {
        _id: String(conversation._id),
        psid: conversation.psid,
        displayName: conversation.displayName,
        linkStatus: conversation.linkStatus,
        contactId: conversation.contactId ? String(conversation.contactId) : null,
        lastInboundAt: conversation.lastInboundAt
          ? new Date(conversation.lastInboundAt).toISOString()
          : null,
        lastOutboundAt: conversation.lastOutboundAt
          ? new Date(conversation.lastOutboundAt).toISOString()
          : null,
        createdAt: conversation.createdAt
          ? new Date(conversation.createdAt).toISOString()
          : null,
      },
      messages: messages.map((m) => ({
        _id: String(m._id),
        mid: m.mid,
        direction: m.direction,
        text: m.text,
        sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : null,
      })),
      contact: contact
        ? {
            _id: String(contact._id),
            businessName: contact.businessName,
            contactName: contact.contactName ?? null,
            pipelineStage: contact.pipelineStage,
            currentStage: contact.currentStage,
            outreachChannel: contact.outreachChannel,
          }
        : null,
      draftLogs: draftLogs.map((log) => ({
        _id: String(log._id),
        stage: log.stage,
        status: log.status,
        body: log.body,
        createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH — link / ignore / unlink
// ---------------------------------------------------------------------------

/**
 * PATCH /api/messenger/conversations/[id]
 *
 * Body: { action: "link", contactId } | { action: "ignore" } | { action: "unlink" }
 *
 * "link" is the retroactive-effects path (spec §A.4 step 3): reply effects
 * are applied for the inbound message that constitutes "they replied", chosen
 * by pickReplyAnchor (src/lib/messenger/linking.ts) — the earliest inbound
 * since our last outbound, falling back to the most recent inbound when every
 * one of them predates it. That fallback is not a nicety: a Page auto-greeting
 * is echoed back within seconds of a first inbound message, so without it a
 * linked prospect kept `not_started` with no engagement bump. Linking a
 * conversation that already had ten stored inbound messages, or linking one
 * twice, still bumps engagement exactly once — applyReplyEffects
 * (src/lib/replyEffects.ts) is idempotent once its anchor log is marked
 * replied, or on the contact's own status when no sent log exists.
 *
 * Linking a PSID to a Contact another conversation already holds is
 * rejected with 409: two PSIDs mapped to one contact would double every
 * future reply effect (two conversations, each finding/stamping the same
 * anchor log independently).
 *
 * "ignore" sets linkStatus: "ignored" and keeps the record (spec §A.4 step 4)
 * — nothing is deleted.
 *
 * "unlink" returns the conversation to "unlinked" and clears contactId. It
 * deliberately does NOT attempt to reverse effects already applied (the
 * contact's engagementScore bump, status/pipelineStage change, and deleted
 * pending follow-ups all stand) — the response says so explicitly so the UI
 * can surface it rather than implying a clean undo.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid conversation id");
    await connectDB();

    const conversation = await MessengerConversation.findById(validId);
    if (!conversation) return notFound(id);

    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
      return badRequest('action must be one of: "link", "ignore", "unlink"');
    }

    if (action === "link") {
      const validContactId = asObjectIdString(body.contactId);
      if (validContactId === null) {
        return badRequest("contactId is required and must be a valid id to link");
      }

      const contact = await Contact.findById(validContactId).lean();
      if (!contact) {
        return NextResponse.json(
          { error: `Contact not found: ${validContactId}` },
          { status: 404 }
        );
      }

      // Reject before any write: a second PSID linked to a contact already
      // held by another conversation would double every future reply effect.
      const holder = await MessengerConversation.findOne({
        contactId: validContactId,
        _id: { $ne: conversation._id },
      }).lean();
      if (holder) {
        return NextResponse.json(
          { error: "This contact is already linked to another Messenger conversation." },
          { status: 409 }
        );
      }

      conversation.linkStatus = "linked";
      conversation.contactId = new Types.ObjectId(validContactId);
      await conversation.save();

      // Which stored inbound message counts as "they replied" — see
      // pickReplyAnchor for the rule and, more importantly, for why it needs a
      // fallback: a Page auto-greeting echoes back within seconds of a first
      // inbound message, leaving every inbound older than lastOutboundAt, and
      // the old "since last outbound" query then found nothing and applied no
      // effects at all.
      //
      // Load inbound ascending and decide in a pure function rather than
      // encoding the rule in a query. Bounded by the same cap as the thread
      // view; a triage conversation is nowhere near it.
      const inboundAsc = await MessengerMessage.find({
        conversationId: conversation._id,
        direction: "in",
      })
        .sort({ sentAt: 1 })
        .limit(MAX_THREAD_MESSAGES)
        .lean();

      const anchorInbound = pickReplyAnchor(inboundAsc, conversation.lastOutboundAt);

      let effectsApplied = false;
      if (anchorInbound) {
        const effects = await applyReplyEffects({
          contactId: validContactId,
          channel: "facebook",
          replyText: anchorInbound.text,
          repliedAt: anchorInbound.sentAt,
        });
        effectsApplied = effects.applied;
      }

      return NextResponse.json({ conversation, effectsApplied });
    }

    if (action === "ignore") {
      conversation.linkStatus = "ignored";
      await conversation.save();
      return NextResponse.json({ conversation });
    }

    // action === "unlink"
    conversation.linkStatus = "unlinked";
    conversation.contactId = null;
    await conversation.save();
    return NextResponse.json({
      conversation,
      note:
        "Unlinking does not reverse reply effects already applied to the contact " +
        "(engagement score, status/pipeline stage, and any follow-ups that were cleared).",
    });
  } catch (err) {
    return handleError(err);
  }
}

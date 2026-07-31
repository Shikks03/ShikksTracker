import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { isSubjectRequiredForChannel } from "@/lib/outreachLogs";
import { EMAIL_CHANNEL_QUERY } from "@/lib/sequence";

export const dynamic = "force-dynamic";

const VALID_CHANNELS = ["email", "facebook", "instagram", "phone"] as const;

export type ChannelFilterResult =
  | { ok: true }
  | { ok: false; httpStatus: 400; error: string };

/**
 * Applies the `?channel=` query filter onto an in-progress Mongo filter
 * object, mutating it in place. Extracted as a pure, DB-free function so the
 * channel predicate can be unit-tested without mocking Mongoose (see
 * src/lib/__tests__/emailLogsChannelFilter.test.ts) — matching the project
 * convention of pure helpers being independently testable
 * (resolveOutreachLogStatusFilter in outreachLogs.ts is the sibling case for
 * the /api/outreach-logs route).
 *
 *  - Invalid channel value → `{ ok: false, httpStatus: 400, ... }`.
 *  - `channel === "email"` → migration-safe: matches an explicit
 *    `channel: "email"` OR a legacy log written before the `channel` field
 *    existed (absent/null). A bare equality check would miss those legacy
 *    logs, making them vanish from the only approval UI (/review) while cron
 *    auto-send (which uses this same EMAIL_CHANNEL_QUERY predicate) still
 *    picks them up — the bug this function fixes. Uses EMAIL_CHANNEL_QUERY
 *    from sequence.ts rather than hand-rolling the equivalent `$or` so the
 *    two stay in lockstep.
 *  - Non-email channel → exact equality is correct: the channel field did
 *    not exist before the multi-channel migration, so there is no
 *    "legacy facebook log" case to account for.
 *
 * Defensive merge: nothing upstream in this route sets `filter.$or` today,
 * but if it ever did, blindly spreading EMAIL_CHANNEL_QUERY's `$or` into
 * `filter` would silently clobber the earlier `$or` (a later object key
 * write replaces the earlier one). Combining via `$and` instead preserves
 * both conditions regardless of what filter shape the caller passes in.
 */
export function applyChannelFilter(
  filter: Record<string, unknown>,
  channel: string
): ChannelFilterResult {
  if (!VALID_CHANNELS.includes(channel as (typeof VALID_CHANNELS)[number])) {
    return {
      ok: false,
      httpStatus: 400,
      error: `channel must be one of: ${VALID_CHANNELS.join(", ")}`,
    };
  }

  if (channel === "email") {
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, EMAIL_CHANNEL_QUERY];
      delete filter.$or;
    } else {
      Object.assign(filter, EMAIL_CHANNEL_QUERY);
    }
  } else {
    filter.channel = channel;
  }

  return { ok: true };
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const contactId = searchParams.get("contactId");
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");
    const channel = searchParams.get("channel");

    if (contactId) filter.contactId = contactId;
    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;
    // Additive, optional filter (Phase 4 multi-channel): the email review
    // queue (/review) now passes channel=email so social/phone drafts don't
    // leak into the email-only review UI. Deliberately NOT defaulted to
    // "email" here — the contact-detail page calls this same endpoint with
    // only `contactId` and must keep showing that contact's full history
    // across every channel.
    if (channel) {
      const result = applyChannelFilter(filter, channel);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.httpStatus });
      }
    }

    // `?count=true` → `{ count }` via countDocuments instead of shipping every
    // matching document. The sidebar badge and the dashboard draft/approved
    // tiles only ever needed the number, but fetched full logs and read
    // `.length` — downloading every draft's subject and body. The sidebar does
    // that on *every* route change (its effect keys on `pathname`), so the cost
    // was paid on each navigation and grows with the draft backlog.
    // Deliberately reuses `filter` so status/channel/campaignId/contactId all
    // behave identically to the list path — including the legacy-log handling
    // in applyChannelFilter.
    if (searchParams.get("count") === "true") {
      const count = await EmailLog.countDocuments(filter);
      return NextResponse.json({ count });
    }

    const logs = await EmailLog.find(filter).lean();
    return NextResponse.json(logs);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { contactId, stage, subject, body: emailBody } = body;

    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (stage !== 1 && stage !== 2 && stage !== 3) {
      return NextResponse.json({ error: "stage must be 1, 2, or 3" }, { status: 400 });
    }
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const contact = await Contact.findById(contactId).lean();
    if (!contact) {
      return NextResponse.json({ error: `Contact not found: ${contactId}` }, { status: 404 });
    }

    // Legacy contacts saved before outreachChannel existed fall back to
    // "email" — same convention as isNonEmailChannel/EMAIL_CHANNEL_QUERY.
    const channel = contact.outreachChannel ?? "email";

    // The channel isn't known until the contact loads, so this check can't
    // run alongside the contactId/stage/body checks above. Facebook/
    // Instagram DMs and phone scripts have no subject line — the EmailLog
    // schema itself only requires `subject` when channel === "email".
    if (
      isSubjectRequiredForChannel(channel) &&
      (!subject || typeof subject !== "string" || !subject.trim())
    ) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }

    const existing = await EmailLog.findOne({
      contactId: contact._id,
      stage,
      // "sending" is included: a log mid-send must not be replaced by a manual compose
      status: { $in: ["approved", "sending", "sent"] },
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: `An approved, sending, or sent log already exists for this contact at stage ${stage as number}` },
        { status: 409 }
      );
    }

    const log = await EmailLog.create({
      contactId: contact._id,
      campaignId: contact.campaignId,
      stage,
      subject: typeof subject === "string" ? subject.trim() : "",
      body: (emailBody as string).trim(),
      status: "approved",
      channel,
    });

    return NextResponse.json(log, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

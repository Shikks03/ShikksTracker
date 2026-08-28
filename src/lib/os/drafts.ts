/**
 * drafts.ts — POST /api/os/drafts (spec §D.2).
 *
 * Creates ONE response draft from an already-human-approved RikuOS queue item.
 * The log is created with status "approved", not "draft": the review gate exists
 * so a human checks AI copy before it sends, and that already happened inside
 * RikuOS — a second approval here would be theatre. (This mirrors the existing
 * /compose behaviour, which is also self-approved by authorship.)
 */

import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { asObjectIdString, asOptionalString, asString } from "@/lib/validate";
import { truncateCodePoints } from "@/lib/os/text";
import type { IEmailLog } from "@/models/EmailLog";
import type { Types } from "mongoose";

/** EmailLog schema caps — keep in sync with src/models/EmailLog.ts. */
export const OS_DRAFT_BODY_MAX = 50_000;
export const OS_DRAFT_SUBJECT_MAX = 500;
export const OS_DRAFT_VARIANT_KEY_MAX = 100;

const CHANNELS = ["email", "facebook", "instagram", "phone"] as const;
export type OsDraftChannel = (typeof CHANNELS)[number];

export interface OsDraftPayload {
  contactId: string;
  channel: OsDraftChannel;
  body: string;
  subject?: string;
  replyToLogId?: string;
  variantKey?: string;
}

export type OsDraftValidation =
  | { ok: true; payload: OsDraftPayload }
  | { ok: false; httpStatus: 400; error: string };

/**
 * Validates the request body. Pure, so the rules are unit-testable without a
 * NextRequest — the same split as checkOsSecret / checkMarkSentAllowed.
 *
 * Every id goes through asObjectIdString, which returns a plain string or null
 * and so cannot pass a `{ $ne: null }`-style operator object into a Mongo
 * filter (see src/lib/validate.ts).
 */
export function validateOsDraftPayload(raw: Record<string, unknown>): OsDraftValidation {
  const contactId = asObjectIdString(raw.contactId);
  if (contactId === null) {
    return { ok: false, httpStatus: 400, error: "contactId is required and must be a valid id" };
  }

  const channel = raw.channel;
  if (typeof channel !== "string" || !CHANNELS.includes(channel as OsDraftChannel)) {
    return { ok: false, httpStatus: 400, error: `channel must be one of: ${CHANNELS.join(", ")}` };
  }

  const body = asString(raw.body, OS_DRAFT_BODY_MAX);
  if (body === null) {
    return {
      ok: false,
      httpStatus: 400,
      error: `body is required and must be 1–${OS_DRAFT_BODY_MAX} characters`,
    };
  }

  const subject = asOptionalString(raw.subject, OS_DRAFT_SUBJECT_MAX);
  const variantKey = asOptionalString(raw.variantKey, OS_DRAFT_VARIANT_KEY_MAX);

  // A malformed replyToLogId is rejected rather than dropped. Dropping it would
  // produce a reply that is neither threaded NOR permitted to reach a replied
  // contact (see src/lib/sendGuards.ts) — a silent half-failure that is far
  // harder to diagnose from RikuOS than a 400.
  let replyToLogId: string | undefined;
  if (raw.replyToLogId !== undefined && raw.replyToLogId !== null) {
    const parsed = asObjectIdString(raw.replyToLogId);
    if (parsed === null) {
      return { ok: false, httpStatus: 400, error: "replyToLogId must be a valid id when provided" };
    }
    replyToLogId = parsed;
  }

  return {
    ok: true,
    payload: {
      contactId,
      channel: channel as OsDraftChannel,
      body,
      ...(subject !== undefined ? { subject } : {}),
      ...(replyToLogId !== undefined ? { replyToLogId } : {}),
      ...(variantKey !== undefined ? { variantKey } : {}),
    },
  };
}

/**
 * The stage to stamp on the new log: inherited from the log being answered, or
 * the contact's current stage.
 *
 * Contact.currentStage starts at 0 ("not started") but EmailLog.stage is
 * enum [1,2,3], so 0 must map to 1 or the create would fail validation.
 *
 * Keeping the stage at (not above) the contact's current stage is load-bearing:
 * advanceContactAfterSend only writes when `currentStage < log.stage`, so an
 * inherited stage guarantees the post-send advance no-ops and a replied contact
 * is never re-entered into the cold sequence.
 */
export function resolveOsDraftStage(
  replyToLogStage: number | null | undefined,
  contactCurrentStage: number | null | undefined
): 1 | 2 | 3 {
  const raw = replyToLogStage ?? contactCurrentStage ?? 1;
  if (raw >= 3) return 3;
  if (raw <= 1) return 1;
  return 2;
}

/**
 * The subject to store. An explicit subject wins; otherwise it is derived from
 * the anchor as "Re: …". sendOneLog re-derives the same value at send time from
 * the threading anchor, so the two agree — this exists so the record is correct
 * before the send, and so the email-channel `subject` requirement on the schema
 * is satisfied at create time.
 */
export function deriveOsDraftSubject(
  provided: string | undefined,
  anchorSubject: string | null | undefined
): string {
  if (provided) return provided;
  if (!anchorSubject) return "";
  const derived = anchorSubject.startsWith("Re:") ? anchorSubject : `Re: ${anchorSubject}`;
  return truncateCodePoints(derived, OS_DRAFT_SUBJECT_MAX);
}

export type CreateOsDraftResult =
  | { ok: true; log: IEmailLog }
  | { ok: false; httpStatus: 404 | 409 | 422; error: string };

/**
 * Loads the contact, refuses anyone we must not write to, resolves the
 * threading anchor and creates the approved log.
 *
 * Refusals are 422 (per spec §D.2) rather than 400: the request was well-formed,
 * the target is simply not contactable.
 */
export async function createOsDraft(payload: OsDraftPayload): Promise<CreateOsDraftResult> {
  const contact = await Contact.findById(payload.contactId).lean();
  if (!contact) {
    return { ok: false, httpStatus: 404, error: `Contact not found: ${payload.contactId}` };
  }

  if (contact.status === "unsubscribed" || contact.status === "bounced") {
    return {
      ok: false,
      httpStatus: 422,
      error: `Contact status is "${contact.status}" — not contactable.`,
    };
  }

  // Suppression is authoritative and independent of contact.status (a human can
  // add an address directly). Guarded on a non-empty email: a non-email contact
  // has no contactEmail, and Suppression.findOne({ email: undefined }) is NOT a
  // safe no-op in MongoDB — it can match documents where the field is absent.
  // Same guard as generateDrafts in src/lib/sequence.ts.
  if (typeof contact.contactEmail === "string" && contact.contactEmail) {
    const suppressed = await Suppression.findOne({ email: contact.contactEmail }).lean();
    if (suppressed) {
      return { ok: false, httpStatus: 422, error: "Contact email is on the suppression list." };
    }
  }

  if (payload.channel === "email" && !contact.contactEmail) {
    return { ok: false, httpStatus: 422, error: "Contact has no email address." };
  }

  let anchor: { _id: Types.ObjectId; stage: number; subject: string } | null = null;
  if (payload.replyToLogId) {
    anchor = (await EmailLog.findOne({
      _id: payload.replyToLogId,
      contactId: contact._id,
      status: "sent",
    })
      .select({ stage: 1, subject: 1 })
      .lean()) as { _id: Types.ObjectId; stage: number; subject: string } | null;

    if (!anchor) {
      return {
        ok: false,
        httpStatus: 422,
        error: "replyToLogId does not match a sent log for this contact.",
      };
    }

    // Idempotency for the RikuOS approval queue: a retried POST for the same
    // queue item must not create a second copy of the same reply. Only pending
    // states block — a previous reply that has already SENT is a legitimate
    // reason to send another one later.
    const pending = await EmailLog.findOne({
      contactId: contact._id,
      replyToLogId: anchor._id,
      status: { $in: ["draft", "approved", "sending"] },
    })
      .select({ _id: 1 })
      .lean();

    if (pending) {
      return {
        ok: false,
        httpStatus: 409,
        error: `A pending reply to that message already exists (log ${String(pending._id)}).`,
      };
    }
  }

  const subject = deriveOsDraftSubject(payload.subject, anchor?.subject ?? null);
  if (payload.channel === "email" && !subject) {
    return {
      ok: false,
      httpStatus: 422,
      error: "subject is required for an email draft with no replyToLogId to derive it from.",
    };
  }

  const log = await EmailLog.create({
    contactId: contact._id,
    campaignId: contact.campaignId,
    stage: resolveOsDraftStage(anchor?.stage ?? null, contact.currentStage),
    status: "approved",
    channel: payload.channel,
    subject,
    body: payload.body,
    origin: "rikuos",
    replyToLogId: anchor?._id ?? null,
    variantKey: payload.variantKey ?? null,
  });

  return { ok: true, log };
}

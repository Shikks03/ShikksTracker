import { connectDB } from "@/lib/db";
import Contact, { IContact } from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { Types } from "mongoose";
import { randomUUID } from "crypto";

// Pure email helpers live in email.ts (no server deps) — import for local use
// and re-export for backward compatibility so all existing server-side imports
// still work unchanged.
import { normalizeEmail, isValidEmail, escapeRegex } from "@/lib/email";
export { normalizeEmail, isValidEmail };

type LeadSource = "cold_email" | "referral" | "event_connection" | "other";
type OutreachChannel = "email" | "facebook" | "instagram" | "phone";
type NonEmailChannel = "facebook" | "instagram" | "phone";

export interface CreateContactInput {
  businessName: string;
  contactEmail?: string;
  contactName?: string;
  keyPoints: string;
  leadSource?: LeadSource;
  campaignId: string | Types.ObjectId;
  outreachChannel?: OutreachChannel;
  phone?: string;
  facebook?: string;
  instagram?: string;
  website?: string;
  sourcePlaceId?: string;
  webPresenceTier?: string;
  claimed?: string;
}

export type CreateContactResult =
  | { outcome: "invalid"; reason: string }
  | { outcome: "suppressed"; reason: string }
  | { outcome: "duplicate" }
  | { outcome: "inserted"; contact: IContact };

/**
 * Single creation path for both CSV import and manual add, across every
 * outreach channel.
 *
 * Branches on `input.outreachChannel` (defaults to "email"):
 *
 *  - **email channel** (unchanged behaviour):
 *     1. Validate email format → outcome "invalid"
 *     2. Check suppression list (normalized) → outcome "suppressed" (never insert)
 *     3. Check existing contact (same normalized email + campaignId) → outcome "duplicate"
 *     4. Insert with defaults + nextSendAt: new Date() → outcome "inserted"
 *
 *  - **non-email channel** (facebook/instagram/phone — scraped Maps leads
 *    with no email captured):
 *     1. Require the handle matching the channel → outcome "invalid" if missing.
 *     2. Email is optional: if provided, validate + suppression-check it same
 *        as the email path; if absent, skip both (no null/empty contactEmail
 *        is ever inserted, so the partial-unique index ignores the contact).
 *     3. Dedupe on `sourcePlaceId` (if provided) else on `businessName`,
 *        scoped to the campaign → outcome "duplicate".
 *     4. Insert with the channel/provenance fields + the same defaults.
 *
 * Caller must ensure connectDB() has been called (or we call it here for
 * consistency so that callers don't need to worry).
 */
export async function createContactChecked(
  input: CreateContactInput,
  importMethod: "csv" | "manual"
): Promise<CreateContactResult> {
  await connectDB();

  const channel = input.outreachChannel ?? "email";

  if (channel === "email") {
    const normalizedEmail = normalizeEmail(input.contactEmail ?? "");

    // 1. Validate email format
    if (!isValidEmail(normalizedEmail)) {
      return { outcome: "invalid", reason: `Invalid email format: ${input.contactEmail ?? ""}` };
    }

    // 2. Check suppression collection
    const suppression = await Suppression.findOne({ email: normalizedEmail }).lean();
    if (suppression) {
      return { outcome: "suppressed", reason: suppression.reason };
    }

    // 3. Check for existing contact in the same campaign
    const existing = await Contact.findOne({
      contactEmail: normalizedEmail,
      campaignId: input.campaignId,
    }).lean();
    if (existing) {
      return { outcome: "duplicate" };
    }

    // 4. Insert — new contacts are immediately due for their stage-1 draft (spec §9).
    // unsubscribeToken is also set by the Mongoose schema default, but explicit here
    // so the value is visible in the creation path and in tests.
    const contact = await Contact.create({
      businessName: input.businessName,
      contactEmail: normalizedEmail,
      contactName: input.contactName,
      keyPoints: input.keyPoints,
      leadSource: input.leadSource ?? "cold_email",
      campaignId: input.campaignId,
      importMethod,
      nextSendAt: new Date(),
      unsubscribeToken: randomUUID(),
    });

    return { outcome: "inserted", contact };
  }

  // --- Non-email channel path (facebook / instagram / phone) ---

  // 1. Require the handle matching the channel.
  const channelHandle = {
    facebook: input.facebook,
    instagram: input.instagram,
    phone: input.phone,
  }[channel as NonEmailChannel];
  if (!channelHandle) {
    return {
      outcome: "invalid",
      reason: `Missing ${channel} handle for ${input.businessName}`,
    };
  }

  // 2. Email is optional on this path — validate + suppression-check only if provided.
  let normalizedEmail: string | undefined;
  if (input.contactEmail) {
    normalizedEmail = normalizeEmail(input.contactEmail);
    if (!isValidEmail(normalizedEmail)) {
      return { outcome: "invalid", reason: `Invalid email format: ${input.contactEmail}` };
    }
    const suppression = await Suppression.findOne({ email: normalizedEmail }).lean();
    if (suppression) {
      return { outcome: "suppressed", reason: suppression.reason };
    }
  }

  // 3. Dedupe: prefer sourcePlaceId (scraped leads), else businessName within the campaign.
  //
  // The businessName fallback is matched case-insensitively and trimmed
  // (anchored ^...$ regex, metacharacters escaped via escapeRegex) so it
  // agrees with the import route's intra-file dedupe key
  // (`businessName.trim().toLowerCase()` in handleScraperImport). Without
  // this, "Sunrise Cafe" imported in one file and "SUNRISE CAFE" imported in
  // a later file would both pass this DB check (exact-match misses the
  // case difference) and insert a duplicate contact.
  //
  // NOTE (lookup-only fix): this closes the common sequential-import case
  // but does not close a race — two concurrent imports/inserts for the same
  // business name could still both pass this findOne before either insert
  // completes. A fully robust fix needs a normalized stored key plus a
  // partial unique index, which is a schema/migration change out of scope
  // here.
  const existing = input.sourcePlaceId
    ? await Contact.findOne({
        sourcePlaceId: input.sourcePlaceId,
        campaignId: input.campaignId,
      }).lean()
    : await Contact.findOne({
        businessName: {
          $regex: `^${escapeRegex(input.businessName.trim())}$`,
          $options: "i",
        },
        campaignId: input.campaignId,
      }).lean();
  if (existing) {
    return { outcome: "duplicate" };
  }

  // 4. Insert with channel/provenance fields, omitting any that are empty strings
  // so schema defaults / the sparse indexes behave correctly.
  const contact = await Contact.create({
    businessName: input.businessName,
    ...(normalizedEmail ? { contactEmail: normalizedEmail } : {}),
    contactName: input.contactName,
    keyPoints: input.keyPoints,
    leadSource: input.leadSource ?? "cold_email",
    campaignId: input.campaignId,
    importMethod,
    outreachChannel: channel,
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.facebook ? { facebook: input.facebook } : {}),
    ...(input.instagram ? { instagram: input.instagram } : {}),
    ...(input.website ? { website: input.website } : {}),
    ...(input.sourcePlaceId ? { sourcePlaceId: input.sourcePlaceId } : {}),
    ...(input.webPresenceTier ? { webPresenceTier: input.webPresenceTier } : {}),
    ...(input.claimed ? { claimed: input.claimed } : {}),
    nextSendAt: new Date(),
    unsubscribeToken: randomUUID(),
  });

  return { outcome: "inserted", contact };
}

// ---------------------------------------------------------------------------
// Suppression transition helper
// ---------------------------------------------------------------------------

export interface SuppressContactOptions {
  /**
   * When true (default), upsert a Suppression entry for the contact's email.
   * Set to false when the Suppression entry already exists (e.g. in the
   * sequence-engine path where we discovered the contact via a Suppression
   * lookup — the entry is already there, no need to re-upsert).
   */
  upsertSuppression?: boolean;
}

/**
 * Shared helper: applies the full "suppress this contact" transition.
 *
 * Steps:
 *  1. Load the contact to get its email (needed for Suppression).
 *     Returns silently if the contact is not found.
 *  2. Optionally upsert a Suppression entry — ONLY when the contact has a
 *     non-empty `contactEmail` string (idempotent — safe to call when an
 *     entry already exists; uses $setOnInsert + $set pattern from replies.ts).
 *     Suppression is an email-address blocklist; a facebook/instagram/phone
 *     contact scraped with no email captured has nothing to add to it. This
 *     is a deliberate semantic decision, not an oversight: skipping the
 *     upsert here avoids a Mongoose cast filter of `{ email: undefined }`,
 *     which strips the `email` key from both the match filter and
 *     `$setOnInsert` (update validators are off by default, so schema
 *     `required` does not catch this) — the query then either patches an
 *     unrelated Suppression row that happens to match `{}` first, or upserts
 *     a junk row with no `email` field at all. An email-less contact still
 *     gets every other part of this transition (status change, pending-log
 *     deletion) — only the Suppression write is skipped.
 *  3. Update the contact:
 *       status  → "bounced" when reason === "bounced", otherwise "unsubscribed"
 *       nextSendAt → null
 *  4. Delete all pending draft/approved logs for the contact.
 *
 * Called by:
 *  - PATCH /api/contacts/[id] (manual status change to unsubscribed/bounced)
 *  - sequence.ts applySuppressionTransition (existing-suppression path, upsertSuppression: false)
 *
 * NOT used by replies.ts opt-out path — that flow interleaves Suppression
 * upsert with EmailLog replied-marking and alert queueing; leave it as-is.
 * See replies.ts for the structurally equivalent inline version.
 *
 * Caller must ensure connectDB() has been called.
 */
export async function suppressContact(
  contactId: Types.ObjectId | string,
  reason: "unsubscribed" | "bounced" | "manual",
  options: SuppressContactOptions = {}
): Promise<void> {
  const { upsertSuppression = true } = options;

  const contact = await Contact.findById(contactId).lean();
  if (!contact) {
    // Contact not found — nothing to do (may have been deleted concurrently)
    return;
  }

  // Only write to the Suppression collection when there is an actual email
  // address to suppress. contact.contactEmail is `undefined` for
  // facebook/instagram/phone contacts with no email captured — passing that
  // straight to Suppression.updateOne's filter is unsafe (see the doc
  // comment above), and there is nothing meaningful to suppress anyway.
  if (upsertSuppression && typeof contact.contactEmail === "string" && contact.contactEmail) {
    // Idempotent upsert: $setOnInsert sets email/addedAt on first insert,
    // $set updates reason on every call (same pattern as replies.ts opt-out path).
    await Suppression.updateOne(
      { email: contact.contactEmail },
      {
        $setOnInsert: { email: contact.contactEmail, addedAt: new Date() },
        $set: { reason },
      },
      { upsert: true }
    );
  }

  const newStatus = reason === "bounced" ? "bounced" : "unsubscribed";
  await Contact.findByIdAndUpdate(contactId, {
    status: newStatus,
    nextSendAt: null,
  });

  await EmailLog.deleteMany({
    contactId,
    status: { $in: ["draft", "approved"] },
  });
}

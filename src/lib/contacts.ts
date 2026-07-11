import { connectDB } from "@/lib/db";
import Contact, { IContact } from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";
import { Types } from "mongoose";
import { randomUUID } from "crypto";

/** Trim and lowercase an email address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Pragmatic email validation — not RFC-5321 complete, but handles the
 * vast majority of real-world addresses while rejecting obvious junk.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

type LeadSource = "cold_email" | "referral" | "event_connection" | "other";

export interface CreateContactInput {
  businessName: string;
  contactEmail: string;
  contactName?: string;
  keyPoints: string;
  leadSource?: LeadSource;
  campaignId: string | Types.ObjectId;
}

export type CreateContactResult =
  | { outcome: "invalid"; reason: string }
  | { outcome: "suppressed"; reason: string }
  | { outcome: "duplicate" }
  | { outcome: "inserted"; contact: IContact };

/**
 * Single creation path for both CSV import and manual add.
 *
 * Steps (in order):
 *  1. Validate email format → outcome "invalid"
 *  2. Check suppression list (normalized) → outcome "suppressed" (never insert)
 *  3. Check existing contact (same normalized email + campaignId) → outcome "duplicate"
 *  4. Insert with defaults + nextSendAt: new Date() → outcome "inserted"
 *
 * Caller must ensure connectDB() has been called (or we call it here for
 * consistency so that callers don't need to worry).
 */
export async function createContactChecked(
  input: CreateContactInput,
  importMethod: "csv" | "manual"
): Promise<CreateContactResult> {
  await connectDB();

  const normalizedEmail = normalizeEmail(input.contactEmail);

  // 1. Validate email format
  if (!isValidEmail(normalizedEmail)) {
    return { outcome: "invalid", reason: `Invalid email format: ${input.contactEmail}` };
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
 *  2. Optionally upsert a Suppression entry (idempotent — safe to call when
 *     an entry already exists; uses $setOnInsert + $set pattern from replies.ts).
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

  if (upsertSuppression) {
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

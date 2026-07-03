import { connectDB } from "@/lib/db";
import Contact, { IContact } from "@/models/Contact";
import Suppression from "@/models/Suppression";
import { Types } from "mongoose";

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

  // 4. Insert — new contacts are immediately due for their stage-1 draft (spec §9)
  const contact = await Contact.create({
    businessName: input.businessName,
    contactEmail: normalizedEmail,
    contactName: input.contactName,
    keyPoints: input.keyPoints,
    leadSource: input.leadSource ?? "cold_email",
    campaignId: input.campaignId,
    importMethod,
    nextSendAt: new Date(),
  });

  return { outcome: "inserted", contact };
}

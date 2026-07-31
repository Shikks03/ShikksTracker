import mongoose, { Document, Schema, Types } from "mongoose";
import { randomUUID } from "crypto";

export interface IContact extends Document {
  businessName: string;
  contactEmail?: string;
  contactName?: string;
  keyPoints: string;
  importMethod: "csv" | "manual";
  leadSource: "cold_email" | "referral" | "event_connection" | "other";
  campaignId: Types.ObjectId;
  outreachChannel: "email" | "facebook" | "instagram" | "phone";
  phone?: string;
  facebook?: string;
  instagram?: string;
  website?: string;
  sourcePlaceId?: string;
  webPresenceTier?: string;
  claimed?: string;
  /**
   * The scraped `recent_review`'s age in whole days, captured at import time
   * (2026-07-30). Prospecting/filtering signal only — never fed into AI
   * prompts (see scraperCsv.ts's DELIBERATE OMISSION note). No index/UI yet.
   */
  recentReviewDays?: number;
  status: "active" | "paused" | "replied" | "bounced" | "unsubscribed";
  /** 0=not started, 1=initial sent, 2=followup1 sent, 3=followup2 sent */
  currentStage: number;
  pipelineStage:
    | "not_started"
    | "contacted"
    | "replied"
    | "call_booked"
    | "proposal_sent"
    | "won"
    | "lost";
  engagementScore: number;
  nextSendAt: Date | null;
  /** Human-scheduled follow-up date. null = no action scheduled. */
  nextActionAt: Date | null;
  /** Optional note describing what action to take. null = no note. */
  nextActionNote: string | null;
  /**
   * Per-contact UUID used in the one-click unsubscribe link embedded in every
   * outbound email. Keeps the link token opaque — does not expose contactId.
   * Assigned at creation; never changes (rotation would break any outstanding
   * emails). Lookup: GET /api/unsubscribe/[token].
   */
  unsubscribeToken: string;
  createdAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    // maxlength bounds below (Security hardening, Wave C) are generous, not
    // tight — the goal is to cap the previously-unbounded-up-to-16MB string
    // fields, not to constrain legitimate values. See src/lib/contacts.ts /
    // scraperCsv.ts / csv.ts for the write-site audit — some of those import
    // paths do not themselves bound length before insert, so these caps are
    // the backstop of last resort, not the only control.
    businessName: { type: String, required: true, maxlength: 200 },
    contactEmail: {
      type: String,
      required: function (this: IContact) {
        return this.outreachChannel === "email";
      },
      lowercase: true,
      trim: true,
      maxlength: 320, // RFC 5321 practical upper bound
    },
    contactName: { type: String, maxlength: 200 },
    keyPoints: { type: String, required: true, maxlength: 4000 },
    importMethod: { type: String, enum: ["csv", "manual"], required: true },
    leadSource: {
      type: String,
      enum: ["cold_email", "referral", "event_connection", "other"],
      required: true,
    },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    outreachChannel: {
      type: String,
      enum: ["email", "facebook", "instagram", "phone"],
      default: "email",
    },
    phone: { type: String, trim: true, maxlength: 50 },
    facebook: { type: String, trim: true, maxlength: 500 },
    instagram: { type: String, trim: true, maxlength: 500 },
    website: { type: String, trim: true, maxlength: 500 },
    sourcePlaceId: { type: String, maxlength: 200 },
    webPresenceTier: { type: String, maxlength: 50 },
    claimed: { type: String, maxlength: 20 },
    recentReviewDays: { type: Number },
    status: {
      type: String,
      enum: ["active", "paused", "replied", "bounced", "unsubscribed"],
      default: "active",
    },
    currentStage: {
      type: Number,
      enum: [0, 1, 2, 3],
      default: 0,
    },
    pipelineStage: {
      type: String,
      enum: [
        "not_started",
        "contacted",
        "replied",
        "call_booked",
        "proposal_sent",
        "won",
        "lost",
      ],
      default: "not_started",
    },
    // `min: 0` documents intent only — it does NOT constrain `$inc` (Mongoose
    // validators do not run on atomic $inc updates unless runValidators is
    // passed, and this codebase's $inc call sites don't). The real control
    // against unbounded growth is the ceiling on the raw counters in the
    // track/open and track/click routes (Security hardening, Wave C, Task 1).
    engagementScore: { type: Number, default: 0, min: 0 },
    nextSendAt: { type: Date, default: null },
    nextActionAt: { type: Date, default: null },
    nextActionNote: { type: String, default: null, maxlength: 500 },
    unsubscribeToken: {
      type: String,
      default: () => randomUUID(),
      // Sparse unique index: the token is always set on new contacts but may be
      // absent on very old docs created before this field was added (pre-migration).
      // The route handles the missing-token case gracefully (neutral response).
      // No maxlength: this holds a generated randomUUID() value, not
      // third-party input — bounding it risks rejecting a legitimate value
      // for no security benefit.
    },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

// Index change (multi-channel): partial unique so email-less contacts don't collide;
// sourcePlaceId dedupe for scraped imports. Live DB needs syncIndexes()/manual drop — see SESSION_NOTES.
// Dedupe within a campaign
ContactSchema.index(
  { contactEmail: 1, campaignId: 1 },
  { unique: true, partialFilterExpression: { contactEmail: { $type: "string" } } }
);
// Dedupe scraped contacts within a campaign by source place id.
// MUST be partial, not sparse: a *compound* sparse index still indexes a document
// as long as it has at least one of the keys — and campaignId is always present.
// With `sparse: true` every email contact would be indexed as
// { sourcePlaceId: null, campaignId: X }, so the second email contact in a campaign
// would fail with a duplicate-key error. The partial filter excludes them properly.
ContactSchema.index(
  { sourcePlaceId: 1, campaignId: 1 },
  { unique: true, partialFilterExpression: { sourcePlaceId: { $type: "string" } } }
);
// Sequence-engine query
ContactSchema.index({ status: 1, nextSendAt: 1 });
// Next-action reminder query — sparse so null entries are not indexed
ContactSchema.index({ nextActionAt: 1 }, { sparse: true });
// Unsubscribe token lookup — sparse+unique; sparse means null/absent docs are excluded
// (pre-migration contacts without a token are not counted against the uniqueness constraint)
ContactSchema.index({ unsubscribeToken: 1 }, { unique: true, sparse: true });

const Contact =
  (mongoose.models.Contact as mongoose.Model<IContact>) ||
  mongoose.model<IContact>("Contact", ContactSchema);

export default Contact;

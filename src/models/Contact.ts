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
    businessName: { type: String, required: true },
    contactEmail: {
      type: String,
      required: function (this: IContact) {
        return this.outreachChannel === "email";
      },
      lowercase: true,
      trim: true,
    },
    contactName: { type: String },
    keyPoints: { type: String, required: true },
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
    phone: { type: String, trim: true },
    facebook: { type: String, trim: true },
    instagram: { type: String, trim: true },
    website: { type: String, trim: true },
    sourcePlaceId: { type: String },
    webPresenceTier: { type: String },
    claimed: { type: String },
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
    engagementScore: { type: Number, default: 0 },
    nextSendAt: { type: Date, default: null },
    nextActionAt: { type: Date, default: null },
    nextActionNote: { type: String, default: null },
    unsubscribeToken: {
      type: String,
      default: () => randomUUID(),
      // Sparse unique index: the token is always set on new contacts but may be
      // absent on very old docs created before this field was added (pre-migration).
      // The route handles the missing-token case gracefully (neutral response).
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index change (multi-channel): partial unique so email-less contacts don't collide;
// sourcePlaceId dedupe for scraped imports. Live DB needs syncIndexes()/manual drop — see SESSION_NOTES.
// Dedupe within a campaign
ContactSchema.index(
  { contactEmail: 1, campaignId: 1 },
  { unique: true, partialFilterExpression: { contactEmail: { $type: "string" } } }
);
// Dedupe scraped contacts within a campaign by source place id
ContactSchema.index({ sourcePlaceId: 1, campaignId: 1 }, { unique: true, sparse: true });
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

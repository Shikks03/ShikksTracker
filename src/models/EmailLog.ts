import mongoose, { Document, Schema, Types } from "mongoose";

export interface IEmailLogLink {
  url: string;
  trackingId: string;
}

export interface IEmailLog extends Document {
  contactId: Types.ObjectId;
  campaignId: Types.ObjectId;
  /** 1=initial, 2=followup1, 3=followup2 */
  stage: 1 | 2 | 3;
  /**
   * Review-gate field: draft → approved → sending → sent
   * "sending" is a transient claim state set atomically before the Gmail call
   * to prevent duplicate sends if two runners race or if the process dies.
   */
  status: "draft" | "approved" | "sending" | "sent";
  channel: "email" | "facebook" | "instagram" | "phone";
  subject: string;
  body: string;
  gmailThreadId: string | null;
  gmailMessageId: string | null;
  /** RFC-2822 Message-ID header (e.g. <CAF…@mail.gmail.com>). Required for Gmail threading via In-Reply-To/References. Fetched post-send via users.messages.get metadata. */
  rfcMessageId: string | null;
  sentAt: Date | null;
  trackingPixelId: string | null;
  openCount: number;
  firstOpenedAt: Date | null;
  links: IEmailLogLink[];
  clickCount: number;
  firstClickedAt: Date | null;
  replied: boolean;
  repliedAt: Date | null;
  /** Full plain-text reply body with quoted text stripped. Populated by reply detection (src/lib/replies.ts). */
  replyBody: string | null;
  /** Single-line preview of replyBody, ≤80 chars. Populated by reply detection (src/lib/replies.ts). */
  replySnippet: string | null;
  /** UTC timestamp set when status transitions to "sending". Used by the stale-send sweep to detect interrupted sends. */
  sendAttemptedAt: Date | null;
  /** Cumulative count of failed send attempts. Incremented on Gmail failure; never reset. */
  sendErrorCount: number;
  /** Error message from the most recent failed send attempt. */
  lastSendError: string | null;
  /** Set when a non-email (facebook/instagram/phone) log is manually marked sent from the dashboard, since there is no Gmail send event to timestamp it. */
  sentManuallyAt: Date | null;
  /** Set by Mongoose `timestamps` on insert. Enables draft-age display and reliable ordering (previously ordering relied on _id). */
  createdAt: Date;
}

const LinkSchema = new Schema<IEmailLogLink>(
  {
    url: { type: String, required: true },
    trackingId: { type: String, required: true },
  },
  { _id: false }
);

const EmailLogSchema = new Schema<IEmailLog>({
  contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
  stage: { type: Number, enum: [1, 2, 3], required: true },
  status: {
    type: String,
    enum: ["draft", "approved", "sending", "sent"],
    default: "draft",
  },
  channel: {
    type: String,
    enum: ["email", "facebook", "instagram", "phone"],
    default: "email",
  },
  subject: {
    type: String,
    required: function (this: IEmailLog) {
      return this.channel === "email";
    },
  },
  body: { type: String, required: true },
  gmailThreadId: { type: String, default: null },
  gmailMessageId: { type: String, default: null },
  rfcMessageId: { type: String, default: null },
  sentAt: { type: Date, default: null },
  trackingPixelId: { type: String, default: null },
  openCount: { type: Number, default: 0 },
  firstOpenedAt: { type: Date, default: null },
  links: { type: [LinkSchema], default: [] },
  clickCount: { type: Number, default: 0 },
  firstClickedAt: { type: Date, default: null },
  replied: { type: Boolean, default: false },
  repliedAt: { type: Date, default: null },
  replyBody: { type: String, default: null },
  replySnippet: { type: String, default: null },
  sendAttemptedAt: { type: Date, default: null },
  sendErrorCount: { type: Number, default: 0 },
  lastSendError: { type: String, default: null },
  sentManuallyAt: { type: Date, default: null },
}, {
  // createdAt only — matches Contact/Campaign convention. Existing docs simply
  // lack the field (fine). No updatedAt: EmailLog mutates constantly (tracking
  // counters) and an updatedAt would carry no useful meaning here.
  timestamps: { createdAt: true, updatedAt: false },
});

// Contact/Campaign list queries
EmailLogSchema.index({ contactId: 1 });
EmailLogSchema.index({ campaignId: 1 });
// Click lookups
EmailLogSchema.index({ "links.trackingId": 1 }, { sparse: true });
// Queue queries (review gate)
EmailLogSchema.index({ status: 1 });
// Daily-cap query: count sent logs within a Manila-day window
EmailLogSchema.index({ status: 1, sentAt: 1 });
// Pixel lookups
EmailLogSchema.index({ trackingPixelId: 1 }, { sparse: true });

const EmailLog =
  (mongoose.models.EmailLog as mongoose.Model<IEmailLog>) ||
  mongoose.model<IEmailLog>("EmailLog", EmailLogSchema);

export default EmailLog;

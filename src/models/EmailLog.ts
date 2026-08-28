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
  /**
   * Which message approach (Variant.key) produced this log's copy, or null for
   * logs written before variants existed and for drafts generated when no
   * active variant matched their channel+stage. Powers the per-approach reply
   * rates in GET /api/os/variant-stats.
   */
  variantKey: string | null;
  /**
   * Provenance. "app" = this application drafted it (sequence engine, /compose,
   * templates). "rikuos" = created through POST /api/os/drafts from RikuOS's
   * approval queue. Legacy logs have no stored field and read as "app".
   */
  origin: "app" | "rikuos";
  /**
   * The `sent` log this message directly answers. Set only by
   * POST /api/os/drafts. Two effects at send time (src/lib/sequence.ts):
   *   1. It is the threading anchor — In-Reply-To / References / threadId come
   *      from this log instead of the stage-based lookup.
   *   2. Its presence is one of the two markers that let sendOneLog deliver to
   *      a contact whose status is "replied" (see src/lib/sendGuards.ts).
   */
  replyToLogId: Types.ObjectId | null;
  /** Set by Mongoose `timestamps` on insert. Enables draft-age display and reliable ordering (previously ordering relied on _id). */
  createdAt: Date;
}

const LinkSchema = new Schema<IEmailLogLink>(
  {
    // 2000 mirrors MAX_TRACKED_URL_LEN in src/lib/tracking.ts, which refuses
    // to turn an over-long URL into a tracked link in the first place — so
    // this maxlength should never actually be hit via that path. It stays as
    // a backstop for any other write site.
    url: { type: String, required: true, maxlength: 2000 },
    trackingId: { type: String, required: true }, // generated randomUUID() — no maxlength
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
    maxlength: 500,
  },
  // AI-drafted bodies are naturally bounded (draft.ts calls Claude with
  // max_tokens: 1024, well under this limit); manual compose/regenerate is
  // self-authored, not third-party. 50000 is a generous backstop either way.
  body: { type: String, required: true, maxlength: 50000 },
  gmailThreadId: { type: String, default: null },
  gmailMessageId: { type: String, default: null },
  rfcMessageId: { type: String, default: null },
  sentAt: { type: Date, default: null },
  trackingPixelId: { type: String, default: null }, // generated randomUUID() — no maxlength
  // `min: 0` documents intent only — it does NOT constrain `$inc` (see the
  // matching note on Contact.engagementScore). The real control is the
  // ceiling on the raw $inc in the track/open route (Security hardening,
  // Wave C, Task 1).
  openCount: { type: Number, default: 0, min: 0 },
  firstOpenedAt: { type: Date, default: null },
  links: { type: [LinkSchema], default: [] },
  clickCount: { type: Number, default: 0, min: 0 }, // same $inc caveat — ceiling enforced in track/click
  firstClickedAt: { type: Date, default: null },
  replied: { type: Boolean, default: false },
  repliedAt: { type: Date, default: null },
  // Written from arbitrary inbound reply text (src/lib/replies.ts) — truncated
  // at the write site via truncateReplyBody() BEFORE reaching this schema, so
  // this maxlength should never actually reject a real write. See replies.ts.
  replyBody: { type: String, default: null, maxlength: 100000 },
  // Bounded independently by makeSnippet() (replies.ts) to <=81 chars, well
  // under this cap — listed for completeness per the schema-bounds sweep.
  replySnippet: { type: String, default: null, maxlength: 500 },
  sendAttemptedAt: { type: Date, default: null },
  sendErrorCount: { type: Number, default: 0, min: 0 },
  // Driver/Gmail-API error strings — truncated at the write site via
  // truncateForStorage() in src/lib/sequence.ts BEFORE reaching this schema.
  lastSendError: { type: String, default: null, maxlength: 2000 },
  sentManuallyAt: { type: Date, default: null },
  variantKey: { type: String, default: null, maxlength: 100 },
  origin: { type: String, enum: ["app", "rikuos"], default: "app" },
  replyToLogId: { type: Schema.Types.ObjectId, ref: "EmailLog", default: null },
}, {
  // createdAt only — matches Contact/Campaign convention. Existing docs simply
  // lack the field (fine). No updatedAt: EmailLog mutates constantly (tracking
  // counters) and an updatedAt would carry no useful meaning here.
  timestamps: { createdAt: true, updatedAt: false },
  strict: true,
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
// Variant stats aggregation (GET /api/os/variant-stats) groups sent logs by
// variantKey. PARTIAL, not sparse: variantKey is null on almost every log, and
// a *compound* sparse index still indexes any document that has at least one of
// the keys — `status` is always present, so `sparse` would index the entire
// collection and save nothing. Same trap already documented on Contact's
// sourcePlaceId index (src/models/Contact.ts).
EmailLogSchema.index(
  { variantKey: 1, status: 1 },
  { partialFilterExpression: { variantKey: { $type: "string" } } }
);

const EmailLog =
  (mongoose.models.EmailLog as mongoose.Model<IEmailLog>) ||
  mongoose.model<IEmailLog>("EmailLog", EmailLogSchema);

export default EmailLog;

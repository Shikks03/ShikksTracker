import mongoose, { Document, Schema } from "mongoose";

/**
 * A message *approach* — the strategy a draft was written with, so reply rates
 * per approach become measurable (RikuOS's retro agent consumes this via
 * GET /api/os/variant-stats). Deliberately NOT an A/B engine: there is no
 * traffic splitting, no significance testing and no automatic winner. The
 * engine simply rotates the least-used active variant for a channel+stage.
 */
export interface IVariant extends Document {
  /** Stable identifier stamped onto EmailLog.variantKey, e.g. "email-s1-painpoint". */
  key: string;
  channel: "email" | "facebook" | "instagram" | "phone";
  stage: 1 | 2 | 3;
  /** Human label for the dashboard / stats output. */
  label: string;
  /** Strategy description appended verbatim to the Claude user message. */
  promptNotes: string;
  /** Inactive variants are never selected, but their historical stats survive. */
  active: boolean;
  createdAt: Date;
}

const VariantSchema = new Schema<IVariant>(
  {
    key: { type: String, required: true, unique: true, maxlength: 100 },
    channel: {
      type: String,
      enum: ["email", "facebook", "instagram", "phone"],
      required: true,
    },
    stage: { type: Number, enum: [1, 2, 3], required: true },
    label: { type: String, required: true, maxlength: 200 },
    // Self-authored (seed script / future UI), not third-party input — but
    // bounded anyway, per the schema-bounds convention every model follows.
    promptNotes: { type: String, required: true, maxlength: 2000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

// Selection query in pickVariantForDraft(): active variants for a channel+stage.
VariantSchema.index({ channel: 1, stage: 1, active: 1 });

const Variant =
  (mongoose.models.Variant as mongoose.Model<IVariant>) ||
  mongoose.model<IVariant>("Variant", VariantSchema);

export default Variant;

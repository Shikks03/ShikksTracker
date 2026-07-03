import mongoose, { Document, Schema, Types } from "mongoose";

export interface IContact extends Document {
  businessName: string;
  contactEmail: string;
  contactName?: string;
  keyPoints: string;
  importMethod: "csv" | "manual";
  leadSource: "cold_email" | "referral" | "event_connection" | "other";
  campaignId: Types.ObjectId;
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
  createdAt: Date;
}

const ContactSchema = new Schema<IContact>(
  {
    businessName: { type: String, required: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactName: { type: String },
    keyPoints: { type: String, required: true },
    importMethod: { type: String, enum: ["csv", "manual"], required: true },
    leadSource: {
      type: String,
      enum: ["cold_email", "referral", "event_connection", "other"],
      required: true,
    },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
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
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Dedupe within a campaign
ContactSchema.index({ contactEmail: 1, campaignId: 1 }, { unique: true });
// Sequence-engine query
ContactSchema.index({ status: 1, nextSendAt: 1 });

const Contact =
  (mongoose.models.Contact as mongoose.Model<IContact>) ||
  mongoose.model<IContact>("Contact", ContactSchema);

export default Contact;

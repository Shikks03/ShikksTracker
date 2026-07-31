import mongoose, { Document, Schema } from "mongoose";

export interface ISuppression extends Document {
  email: string;
  reason: "unsubscribed" | "bounced" | "manual";
  addedAt: Date;
}

const SuppressionSchema = new Schema<ISuppression>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 320, // RFC 5321 practical upper bound — matches Contact.contactEmail
    },
    reason: {
      type: String,
      enum: ["unsubscribed", "bounced", "manual"],
      required: true,
    },
    addedAt: { type: Date, default: Date.now },
  },
  { strict: true }
);

const Suppression =
  (mongoose.models.Suppression as mongoose.Model<ISuppression>) ||
  mongoose.model<ISuppression>("Suppression", SuppressionSchema);

export default Suppression;

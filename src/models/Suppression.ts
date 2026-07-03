import mongoose, { Document, Schema } from "mongoose";

export interface ISuppression extends Document {
  email: string;
  reason: "unsubscribed" | "bounced" | "manual";
  addedAt: Date;
}

const SuppressionSchema = new Schema<ISuppression>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  reason: {
    type: String,
    enum: ["unsubscribed", "bounced", "manual"],
    required: true,
  },
  addedAt: { type: Date, default: Date.now },
});

const Suppression =
  (mongoose.models.Suppression as mongoose.Model<ISuppression>) ||
  mongoose.model<ISuppression>("Suppression", SuppressionSchema);

export default Suppression;

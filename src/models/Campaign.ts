import mongoose, { Document, Schema } from "mongoose";

export interface ICampaign extends Document {
  name: string;
  offerSummary: string;
  toneNotes: string;
  sequenceSpacingDays: number[];
  createdAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true },
    offerSummary: { type: String, required: true },
    toneNotes: { type: String, default: "" },
    sequenceSpacingDays: { type: [Number], default: [0, 5, 9] },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const Campaign =
  (mongoose.models.Campaign as mongoose.Model<ICampaign>) ||
  mongoose.model<ICampaign>("Campaign", CampaignSchema);

export default Campaign;

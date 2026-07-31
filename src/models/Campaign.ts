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
    name: { type: String, required: true, maxlength: 200 },
    offerSummary: { type: String, required: true, maxlength: 5000 },
    toneNotes: { type: String, default: "", maxlength: 2000 },
    sequenceSpacingDays: { type: [Number], default: [0, 5, 9] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

const Campaign =
  (mongoose.models.Campaign as mongoose.Model<ICampaign>) ||
  mongoose.model<ICampaign>("Campaign", CampaignSchema);

export default Campaign;

import mongoose, { Document, Schema } from "mongoose";
import type { RunSummary } from "@/lib/sequence";

export interface ICronRun extends Document {
  startedAt: Date;
  durationMs: number;
  summary: RunSummary;
  errorCount: number;
  /** Set to the timestamp when an error digest was emailed for this run's Manila day. */
  digestSentAt: Date | null;
  /** Set to the timestamp when an action-reminder digest was emailed for this run's Manila day. */
  actionDigestSentAt: Date | null;
}

const CronRunSchema = new Schema<ICronRun>({
  startedAt: { type: Date, required: true },
  durationMs: { type: Number, required: true },
  summary: { type: Schema.Types.Mixed, required: true },
  errorCount: { type: Number, required: true },
  digestSentAt: { type: Date, default: null },
  actionDigestSentAt: { type: Date, default: null },
});

// TTL index: auto-expire documents 30 days after startedAt
CronRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 2592000 });

const CronRun =
  (mongoose.models.CronRun as mongoose.Model<ICronRun>) ||
  mongoose.model<ICronRun>("CronRun", CronRunSchema);

export default CronRun;

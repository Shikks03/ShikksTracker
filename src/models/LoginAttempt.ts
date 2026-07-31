import mongoose, { Document, Schema } from "mongoose";

export interface ILoginAttempt extends Document {
  ip: string;
  createdAt: Date;
}

const LoginAttemptSchema = new Schema<ILoginAttempt>(
  {
    ip: {
      type: String,
      required: true,
      maxlength: 64,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  { strict: true }
);

// TTL index — failed-attempt records auto-expire 15 minutes after creation,
// so the collection never grows unbounded and old failures stop counting
// against the lockout window on their own.
LoginAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });

// Supports the per-IP failure count query (ip match, newest first).
LoginAttemptSchema.index({ ip: 1, createdAt: -1 });

const LoginAttempt =
  (mongoose.models.LoginAttempt as mongoose.Model<ILoginAttempt>) ||
  mongoose.model<ILoginAttempt>("LoginAttempt", LoginAttemptSchema);

export default LoginAttempt;

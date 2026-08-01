import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
  draftGenerationEnabled: boolean;
  sendingEnabled: boolean;
  updatedAt: Date;
}

// Singleton: exactly one document ever exists (see src/lib/settings.ts, which
// always queries with an empty filter `{}`). Both flags default to false so
// that shipping this feature does not silently turn on automated drafting or
// sending — the user opts in explicitly per stage from /settings.
const SettingsSchema = new Schema<ISettings>(
  {
    draftGenerationEnabled: { type: Boolean, required: true, default: false },
    sendingEnabled:         { type: Boolean, required: true, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true }, strict: true }
);

const Settings =
  (mongoose.models.Settings as mongoose.Model<ISettings>) ||
  mongoose.model<ISettings>("Settings", SettingsSchema);

export default Settings;

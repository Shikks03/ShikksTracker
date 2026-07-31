import mongoose, { Document, Schema } from "mongoose";

export interface ITemplate extends Document {
  name: string;
  subject: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    name:    { type: String, required: true, trim: true, maxlength: 200 },
    subject: { type: String, required: true, trim: true, maxlength: 500 },
    // AI-generate-a-template (src/lib/draft.ts) is max_tokens-bounded like the
    // other Claude call sites; manual entry is self-authored. Generous backstop.
    body:    { type: String, required: true, trim: true, maxlength: 50000 },
  },
  { timestamps: { createdAt: true, updatedAt: true }, strict: true }
);

// Index by name for faster lookups; not unique (allow same name across revisions)
TemplateSchema.index({ name: 1 });

const Template =
  (mongoose.models.Template as mongoose.Model<ITemplate>) ||
  mongoose.model<ITemplate>("Template", TemplateSchema);

export default Template;

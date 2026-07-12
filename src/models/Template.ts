import mongoose, { Document, Schema } from "mongoose";

export interface ITemplate extends Document {
  name: string;
  subject: string;
  body: string;
  createdAt: Date;
}

const TemplateSchema = new Schema<ITemplate>(
  {
    name:    { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    body:    { type: String, required: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index by name for faster lookups; not unique (allow same name across revisions)
TemplateSchema.index({ name: 1 });

const Template =
  (mongoose.models.Template as mongoose.Model<ITemplate>) ||
  mongoose.model<ITemplate>("Template", TemplateSchema);

export default Template;

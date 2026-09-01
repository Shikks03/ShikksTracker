import mongoose, { Document, Schema, Types } from "mongoose";

export type MessengerDirection = "in" | "out";

export interface IMessengerMessage extends Document {
  conversationId: Types.ObjectId;
  /** Meta's message id. THE dedupe key — Meta redelivers on any non-200. */
  mid: string;
  /** "out" = a message_echoes event, i.e. the page sent it. */
  direction: MessengerDirection;
  text: string;
  /** Meta's event timestamp, not our receipt time. */
  sentAt: Date;
  createdAt: Date;
}

const MessengerMessageSchema = new Schema<IMessengerMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "MessengerConversation",
      required: true,
    },
    mid: { type: String, required: true, unique: true, maxlength: 128 },
    direction: { type: String, enum: ["in", "out"], required: true },
    // Arbitrary third-party text. Truncated at the write site in events.ts.
    text: { type: String, default: "", maxlength: 10000 },
    sentAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

// Thread view: one conversation, newest first.
MessengerMessageSchema.index({ conversationId: 1, sentAt: -1 });
// summary.messenger.lastEventAt reads the newest row overall.
MessengerMessageSchema.index({ createdAt: -1 });

const MessengerMessage =
  (mongoose.models.MessengerMessage as mongoose.Model<IMessengerMessage>) ||
  mongoose.model<IMessengerMessage>("MessengerMessage", MessengerMessageSchema);

export default MessengerMessage;

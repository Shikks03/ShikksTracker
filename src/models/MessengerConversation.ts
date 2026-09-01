import mongoose, { Document, Schema, Types } from "mongoose";

export type MessengerLinkStatus = "unlinked" | "linked" | "ignored";

export interface IMessengerConversation extends Document {
  /** Meta page-scoped sender ID. Anonymous and page-specific — it cannot be
   *  derived from Contact.facebook, which is why linking is a human step. */
  psid: string;
  /** From Graph API GET /{psid}?fields=first_name,last_name. Empty when the
   *  lookup fails — never block ingestion on a profile fetch. */
  displayName: string;
  contactId: Types.ObjectId | null;
  linkStatus: MessengerLinkStatus;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  createdAt: Date;
}

const MessengerConversationSchema = new Schema<IMessengerConversation>(
  {
    psid: { type: String, required: true, unique: true, maxlength: 64 },
    // Third-party-supplied (Meta profile API) — bounded per the security-phase-2
    // rule that every model field carrying outside text has a maxlength, and
    // truncated at the write site in profile.ts before it reaches here.
    displayName: { type: String, default: "", maxlength: 200 },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
    linkStatus: {
      type: String,
      enum: ["unlinked", "linked", "ignored"],
      default: "unlinked",
    },
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

// Triage list: unlinked first, newest inbound first.
MessengerConversationSchema.index({ linkStatus: 1, lastInboundAt: -1 });
// Reverse lookup when a contact is opened from the contact detail page.
MessengerConversationSchema.index(
  { contactId: 1 },
  { partialFilterExpression: { contactId: { $type: "objectId" } } }
);

const MessengerConversation =
  (mongoose.models.MessengerConversation as mongoose.Model<IMessengerConversation>) ||
  mongoose.model<IMessengerConversation>(
    "MessengerConversation",
    MessengerConversationSchema
  );

export default MessengerConversation;

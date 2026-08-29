/**
 * Meta webhook payload → normalised events (spec §A.2).
 *
 * Pure and total: this parses whatever a public endpoint received. It must
 * never throw — a throw here becomes a non-200, and Meta responds to repeated
 * non-200s by retrying and then disabling the subscription. Anything
 * unrecognised is dropped silently and returns [].
 */

/** Matches MessengerMessage.text's maxlength. Truncated here, at the write
 *  site, per the security-phase-2 rule for third-party text. */
export const MESSENGER_TEXT_MAX_LEN = 10_000;

export interface MessengerEvent {
  psid: string;
  mid: string;
  direction: "in" | "out";
  text: string;
  sentAt: Date;
}

/** `.slice()` counts UTF-16 code units and Messenger text is full of emoji, so
 *  a naive slice can split a surrogate pair. Array.from splits on code points.
 *  Same rationale as truncateReplyBody in src/lib/replies.ts. */
function truncateText(text: string): string {
  if (text.length <= MESSENGER_TEXT_MAX_LEN) return text;
  const chars = Array.from(text);
  if (chars.length <= MESSENGER_TEXT_MAX_LEN) return text;
  return chars.slice(0, MESSENGER_TEXT_MAX_LEN).join("") + "…";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function readId(v: unknown): string | null {
  if (!isRecord(v)) return null;
  const id = v.id;
  return typeof id === "string" && id.length > 0 && id.length <= 64 ? id : null;
}

export function parseMessengerPayload(payload: unknown): MessengerEvent[] {
  if (!isRecord(payload) || payload.object !== "page") return [];
  const entries = payload.entry;
  if (!Array.isArray(entries)) return [];

  const events: MessengerEvent[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const items = entry.messaging;
    if (!Array.isArray(items)) continue;

    const entryTime = typeof entry.time === "number" ? entry.time : null;

    for (const item of items) {
      if (!isRecord(item)) continue;

      // Delivery/read receipts and every other non-message event carry no
      // `message` key. Ignore silently — they are normal traffic, not errors.
      const message = item.message;
      if (!isRecord(message)) continue;

      const mid = typeof message.mid === "string" ? message.mid : null;
      // No mid means no dedupe key, and Meta redelivers. Storing it would
      // duplicate the message on every retry, so drop it instead.
      if (!mid || mid.length > 128) continue;

      const isEcho = message.is_echo === true;

      // THE PSID BRANCH. On an inbound event sender.id is the user; on an echo
      // sender.id is the PAGE and the user is recipient.id. Reading sender.id
      // unconditionally files all outbound traffic under a conversation keyed
      // by the page id. Pinned by a test — do not "simplify" this.
      const psid = isEcho ? readId(item.recipient) : readId(item.sender);
      if (!psid) continue;

      let text: string;
      if (typeof message.text === "string" && message.text.length > 0) {
        text = truncateText(message.text);
      } else if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        // No media download in v0 (spec §A.2). The placeholder keeps the
        // thread readable and stops an image-only reply looking like an
        // empty message.
        text = "[attachment]";
      } else {
        text = "";
      }

      const ts = typeof item.timestamp === "number" ? item.timestamp : entryTime;

      events.push({
        psid,
        mid,
        direction: isEcho ? "out" : "in",
        text,
        sentAt: new Date(ts ?? Date.now()),
      });
    }
  }

  return events;
}

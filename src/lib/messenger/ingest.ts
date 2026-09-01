/**
 * Webhook persistence + effect dispatch (spec §A.2, §A.5, §A.6).
 *
 * Contract with the route: this NEVER throws. The route must return 200 to
 * Meta even when an effect fails, or Meta retries and eventually disables the
 * subscription. Per-event errors are collected and returned for logging.
 */

import MessengerConversation from "@/models/MessengerConversation";
import MessengerMessage from "@/models/MessengerMessage";
import { fetchDisplayName } from "@/lib/messenger/profile";
import { applyReplyEffects } from "@/lib/replyEffects";
import { maybeAutoMarkSent } from "@/lib/messenger/echo";
import type { MessengerEvent } from "@/lib/messenger/events";

export interface IngestResult {
  stored: number;
  duplicates: number;
  effectsApplied: number;
  errors: string[];
}

export async function ingestMessengerEvents(
  events: readonly MessengerEvent[]
): Promise<IngestResult> {
  const result: IngestResult = { stored: 0, duplicates: 0, effectsApplied: 0, errors: [] };

  for (const event of events) {
    try {
      // --- Conversation upsert -------------------------------------------
      // $setOnInsert so a re-delivered first message does not reset link state.
      await MessengerConversation.updateOne(
        { psid: event.psid },
        {
          $setOnInsert: { psid: event.psid, linkStatus: "unlinked", displayName: "" },
          $set:
            event.direction === "in"
              ? { lastInboundAt: event.sentAt }
              : { lastOutboundAt: event.sentAt },
        },
        { upsert: true }
      );

      const conversation = await MessengerConversation.findOne({ psid: event.psid });
      if (!conversation) {
        result.errors.push(`Conversation vanished for psid ${event.psid}`);
        continue;
      }

      // Backfill the name once, lazily. Doing it inside the upsert would cost a
      // Graph call on every single event.
      if (!conversation.displayName) {
        const name = await fetchDisplayName(event.psid);
        if (name) {
          conversation.displayName = name;
          await conversation.save();
        }
      }

      // --- Message insert (THE idempotency point) -------------------------
      // Meta redelivers on any non-200, and a duplicate inbound message would
      // otherwise re-run reply effects. upsertedCount tells us whether this
      // delivery was genuinely new.
      const write = await MessengerMessage.updateOne(
        { mid: event.mid },
        {
          $setOnInsert: {
            conversationId: conversation._id,
            mid: event.mid,
            direction: event.direction,
            text: event.text,
            sentAt: event.sentAt,
          },
        },
        { upsert: true }
      );

      const isNew = (write.upsertedCount ?? 0) > 0;
      if (!isNew) {
        result.duplicates++;
        continue;
      }
      result.stored++;

      // --- Effects, new messages only -------------------------------------
      if (!conversation.contactId || conversation.linkStatus !== "linked") {
        // Unlinked: stored and surfaced for triage, but there is no contact to
        // apply effects to yet. Linking replays them (Task 8).
        continue;
      }

      if (event.direction === "in") {
        const effects = await applyReplyEffects({
          contactId: conversation.contactId,
          channel: "facebook",
          replyText: event.text,
          repliedAt: event.sentAt,
        });
        if (effects.applied) result.effectsApplied++;
      } else {
        await maybeAutoMarkSent(conversation.contactId, event.text);
      }
    } catch (err: unknown) {
      // Collected, never rethrown — see the module docblock.
      result.errors.push(
        `${event.mid}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

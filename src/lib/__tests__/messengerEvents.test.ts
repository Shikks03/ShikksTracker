import { describe, it, expect } from "vitest";
import { parseMessengerPayload, MESSENGER_TEXT_MAX_LEN } from "@/lib/messenger/events";

const inbound = {
  object: "page",
  entry: [
    {
      id: "PAGE_ID",
      time: 1756500000000,
      messaging: [
        {
          sender: { id: "USER_PSID" },
          recipient: { id: "PAGE_ID" },
          timestamp: 1756500000000,
          message: { mid: "m_in_1", text: "Hi, magkano po?" },
        },
      ],
    },
  ],
};

const echo = {
  object: "page",
  entry: [
    {
      id: "PAGE_ID",
      time: 1756500100000,
      messaging: [
        {
          sender: { id: "PAGE_ID" },
          recipient: { id: "USER_PSID" },
          timestamp: 1756500100000,
          message: { mid: "m_out_1", is_echo: true, text: "Salamat! 500 po." },
        },
      ],
    },
  ],
};

describe("parseMessengerPayload", () => {
  it("parses an inbound text message", () => {
    expect(parseMessengerPayload(inbound)).toEqual([
      {
        psid: "USER_PSID",
        mid: "m_in_1",
        direction: "in",
        text: "Hi, magkano po?",
        sentAt: new Date(1756500000000),
      },
    ]);
  });

  it("takes the PSID from recipient.id on an echo, not sender.id", () => {
    const [event] = parseMessengerPayload(echo);
    expect(event.psid).toBe("USER_PSID"); // NOT "PAGE_ID"
    expect(event.direction).toBe("out");
  });

  it("ignores delivery and read receipts silently", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: "P",
          time: 1,
          messaging: [
            { sender: { id: "U" }, recipient: { id: "P" }, delivery: { watermark: 1 } },
            { sender: { id: "U" }, recipient: { id: "P" }, read: { watermark: 1 } },
          ],
        },
      ],
    };
    expect(parseMessengerPayload(payload)).toEqual([]);
  });

  it("ignores a payload whose object is not 'page'", () => {
    expect(parseMessengerPayload({ object: "instagram", entry: [] })).toEqual([]);
  });

  it("represents an attachment-only message as a placeholder", () => {
    const payload = {
      object: "page",
      entry: [{ id: "P", time: 1, messaging: [{
        sender: { id: "U" }, recipient: { id: "P" }, timestamp: 5,
        message: { mid: "m2", attachments: [{ type: "image", payload: { url: "https://x/y.jpg" } }] },
      }] }],
    };
    expect(parseMessengerPayload(payload)[0].text).toBe("[attachment]");
  });

  it("drops a message with no mid — there is no dedupe key without it", () => {
    const payload = {
      object: "page",
      entry: [{ id: "P", time: 1, messaging: [{
        sender: { id: "U" }, recipient: { id: "P" }, timestamp: 5, message: { text: "hi" },
      }] }],
    };
    expect(parseMessengerPayload(payload)).toEqual([]);
  });

  it("flattens multiple entries and multiple messaging items", () => {
    const payload = {
      object: "page",
      entry: [
        { id: "P", time: 1, messaging: [
          { sender: { id: "A" }, recipient: { id: "P" }, timestamp: 1, message: { mid: "a", text: "1" } },
          { sender: { id: "B" }, recipient: { id: "P" }, timestamp: 2, message: { mid: "b", text: "2" } },
        ] },
        { id: "P", time: 3, messaging: [
          { sender: { id: "C" }, recipient: { id: "P" }, timestamp: 3, message: { mid: "c", text: "3" } },
        ] },
      ],
    };
    expect(parseMessengerPayload(payload).map((e) => e.mid)).toEqual(["a", "b", "c"]);
  });

  it("truncates over-long text code-point-safely", () => {
    const long = "😀".repeat(MESSENGER_TEXT_MAX_LEN + 100);
    const payload = {
      object: "page",
      entry: [{ id: "P", time: 1, messaging: [{
        sender: { id: "U" }, recipient: { id: "P" }, timestamp: 1,
        message: { mid: "m", text: long },
      }] }],
    };
    const { text } = parseMessengerPayload(payload)[0];
    expect(Array.from(text).length).toBeLessThanOrEqual(MESSENGER_TEXT_MAX_LEN + 1);
    // No lone surrogate at the cut point.
    expect(text).toBe(Array.from(text).join(""));
    // And it must fit MessengerMessage.text's maxlength, which counts UTF-16
    // units — not code points. An all-emoji message is the case that separates
    // the two: bounding on code points alone leaves it at ~2x the cap.
    expect(text.length).toBeLessThanOrEqual(10_000);
  });

  it("keeps an emoji-only message inside the schema's UTF-16 cap", () => {
    const long = "😀".repeat(9_000); // 9,000 code points, 18,000 UTF-16 units
    const payload = {
      object: "page",
      entry: [{ id: "P", time: 1, messaging: [{
        sender: { id: "U" }, recipient: { id: "P" }, timestamp: 1,
        message: { mid: "m", text: long },
      }] }],
    };
    const { text } = parseMessengerPayload(payload)[0];
    expect(text.length).toBeLessThanOrEqual(10_000);
    expect(text.endsWith("…")).toBe(true);
    expect(text).toBe(Array.from(text).join(""));
  });

  it("returns [] rather than throwing on structurally junk input", () => {
    expect(parseMessengerPayload(null)).toEqual([]);
    expect(parseMessengerPayload({ object: "page" })).toEqual([]);
    expect(parseMessengerPayload({ object: "page", entry: "nope" })).toEqual([]);
    expect(parseMessengerPayload({ object: "page", entry: [{ messaging: null }] })).toEqual([]);
  });

  it("falls back to entry.time when the item has no timestamp", () => {
    const payload = {
      object: "page",
      entry: [{ id: "P", time: 999, messaging: [{
        sender: { id: "U" }, recipient: { id: "P" }, message: { mid: "m", text: "x" },
      }] }],
    };
    expect(parseMessengerPayload(payload)[0].sentAt).toEqual(new Date(999));
  });
});

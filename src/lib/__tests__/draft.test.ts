/**
 * Unit tests for buildUserMessage in src/lib/draft.ts.
 *
 * Tests:
 *   (a) no feedback / previousAttempt → output identical to prior behaviour
 *   (b) with feedback + previousAttempt → message contains rejection section
 *
 * Does NOT call the Anthropic API — only the pure buildUserMessage helper is tested.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK so generateEmailDraft's channel-branching logic can
// be exercised without a real API call. vi.mock is hoisted above imports, so
// the mock function itself must come from vi.hoisted to avoid a
// temporal-dead-zone reference error.
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: mockCreate } };
  }),
}));

import {
  buildUserMessage,
  buildChannelUserMessage,
  generateEmailDraft,
  SYSTEM_PROMPT,
  SOCIAL_DM_SYSTEM_PROMPT,
  PHONE_SCRIPT_SYSTEM_PROMPT,
} from "@/lib/draft";
import type { DraftInput } from "@/lib/draft";

// ---------------------------------------------------------------------------
// Minimal valid input used as a baseline
// ---------------------------------------------------------------------------

const BASE_INPUT: DraftInput = {
  offerSummary: "Affordable social media management",
  toneNotes: "Warm and professional",
  businessName: "Sunrise Bakery",
  contactName: "Maria",
  keyPoints: "Family-owned, Instagram presence, specialises in pandesal",
  stage: 1,
};

// ---------------------------------------------------------------------------
// (a) Behaviour unchanged when no feedback / previousAttempt
// ---------------------------------------------------------------------------

describe("buildUserMessage — baseline (no feedback / previousAttempt)", () => {
  it("includes business name in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Business name: Sunrise Bakery");
  });

  it("includes contact name in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Contact name: Maria");
  });

  it("includes stage in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Stage: 1");
    expect(msg).toContain("initial outreach");
  });

  it("includes offer summary in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Offer summary: Affordable social media management");
  });

  it("includes tone notes in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Tone notes: Warm and professional");
  });

  it("includes key points in the output", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).toContain("Key points / personalization notes: Family-owned");
  });

  it("does NOT include rejected-draft section when previousAttempt is absent", () => {
    const msg = buildUserMessage(BASE_INPUT);
    expect(msg).not.toContain("REJECTED DRAFT");
    expect(msg).not.toContain("Reason for rejection");
    expect(msg).not.toContain("do not repeat the rejected version");
  });

  it("falls back to (not provided) when contactName is absent", () => {
    const input: DraftInput = { ...BASE_INPUT, contactName: undefined };
    const msg = buildUserMessage(input);
    expect(msg).toContain("Contact name: (not provided)");
  });

  it("falls back to default tone note when toneNotes is empty string", () => {
    const input: DraftInput = { ...BASE_INPUT, toneNotes: "" };
    const msg = buildUserMessage(input);
    expect(msg).toContain("(none — default to professional and warm)");
  });

  it("does NOT include previous emails section for stage 1", () => {
    const input: DraftInput = {
      ...BASE_INPUT,
      stage: 1,
      previousEmails: [{ subject: "Hello", body: "Earlier email body" }],
    };
    const msg = buildUserMessage(input);
    // stage 1 — previous emails block should be omitted even if provided
    expect(msg).not.toContain("Previous email(s) sent to this contact:");
  });

  it("includes previous emails section for stage 2 when previousEmails is provided", () => {
    const input: DraftInput = {
      ...BASE_INPUT,
      stage: 2,
      previousEmails: [{ subject: "Hello there", body: "Initial outreach body" }],
    };
    const msg = buildUserMessage(input);
    expect(msg).toContain("Previous email(s) sent to this contact:");
    expect(msg).toContain("Subject: Hello there");
    expect(msg).toContain("Body:\nInitial outreach body");
  });

  it("produces the same output on two calls with identical input (pure function)", () => {
    expect(buildUserMessage(BASE_INPUT)).toBe(buildUserMessage(BASE_INPUT));
  });
});

// ---------------------------------------------------------------------------
// (b) Rejection section present when feedback + previousAttempt are provided
// ---------------------------------------------------------------------------

describe("buildUserMessage — with feedback + previousAttempt", () => {
  const PREV_ATTEMPT = {
    subject: "Quick question for Sunrise Bakery",
    body: "I wanted to reach out about your bakery. We help businesses like yours grow.",
  };

  it("includes the REJECTED DRAFT delimiter", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic, needs to mention pandesal specifically",
    });
    expect(msg).toContain("--- REJECTED DRAFT (do NOT repeat this) ---");
  });

  it("includes the rejected subject", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain(`Rejected subject: ${PREV_ATTEMPT.subject}`);
  });

  it("includes the rejected body", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain(`Rejected body:\n${PREV_ATTEMPT.body}`);
  });

  it("includes the reason for rejection when feedback is provided", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic, needs to mention pandesal",
    });
    expect(msg).toContain("Reason for rejection: Too generic, needs to mention pandesal");
  });

  it("includes the instruction not to repeat the rejected version", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain("do not repeat the rejected version");
  });

  it("references 'the feedback above' in the instruction when feedback is given", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain("the feedback above");
  });

  it("references 'the reviewer's concerns' when no feedback is given but previousAttempt is present", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      // no feedback
    });
    expect(msg).not.toContain("Reason for rejection");
    expect(msg).toContain("the reviewer's concerns");
  });

  it("still includes all standard contact / campaign fields alongside the rejection section", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain("Business name: Sunrise Bakery");
    expect(msg).toContain("Offer summary: Affordable social media management");
    expect(msg).toContain("Key points / personalization notes:");
  });

  it("rejection section appears after the standard fields (ordering)", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    const keyPointsIdx = msg.indexOf("Key points / personalization notes:");
    const rejectionIdx = msg.indexOf("--- REJECTED DRAFT");
    expect(keyPointsIdx).toBeGreaterThan(-1);
    expect(rejectionIdx).toBeGreaterThan(-1);
    expect(rejectionIdx).toBeGreaterThan(keyPointsIdx);
  });

  it("closing delimiter is present", () => {
    const msg = buildUserMessage({
      ...BASE_INPUT,
      previousAttempt: PREV_ATTEMPT,
      feedback: "Too generic",
    });
    expect(msg).toContain("--- END REJECTED DRAFT ---");
  });
});

// ---------------------------------------------------------------------------
// buildChannelUserMessage — non-email builder
// ---------------------------------------------------------------------------

describe("buildChannelUserMessage", () => {
  it("states the channel explicitly for facebook", () => {
    const msg = buildChannelUserMessage({ ...BASE_INPUT, channel: "facebook" });
    expect(msg).toContain("Channel: Facebook DM");
  });

  it("states the channel explicitly for instagram", () => {
    const msg = buildChannelUserMessage({ ...BASE_INPUT, channel: "instagram" });
    expect(msg).toContain("Channel: Instagram DM");
  });

  it("states the channel explicitly for phone", () => {
    const msg = buildChannelUserMessage({ ...BASE_INPUT, channel: "phone" });
    expect(msg).toContain("Channel: Phone call");
  });

  it("omits email-specific framing (no 'Subject:' label, no 'email(s)' wording)", () => {
    const msg = buildChannelUserMessage({
      ...BASE_INPUT,
      channel: "facebook",
      stage: 2,
      previousEmails: [{ subject: "Hello", body: "Earlier touch body" }],
    });
    expect(msg).not.toContain("Subject:");
    expect(msg).not.toContain("Previous email(s)");
    expect(msg).toContain("Previous message(s) sent to this contact:");
    expect(msg).toContain("Earlier touch body");
  });

  it("still includes the standard contact/campaign fields", () => {
    const msg = buildChannelUserMessage({ ...BASE_INPUT, channel: "facebook" });
    expect(msg).toContain("Business name: Sunrise Bakery");
    expect(msg).toContain("Offer summary: Affordable social media management");
    expect(msg).toContain("Key points / personalization notes:");
  });

  it("includes a rejected-draft section without a rejected subject line", () => {
    const msg = buildChannelUserMessage({
      ...BASE_INPUT,
      channel: "phone",
      previousAttempt: { subject: "", body: "Rejected phone script body" },
      feedback: "Too pushy",
    });
    expect(msg).toContain("--- REJECTED DRAFT (do NOT repeat this) ---");
    expect(msg).toContain("Rejected message:\nRejected phone script body");
    expect(msg).not.toContain("Rejected subject:");
  });
});

// ---------------------------------------------------------------------------
// generateEmailDraft — channel branching (mocked Anthropic client)
// ---------------------------------------------------------------------------

describe("generateEmailDraft — channel branching", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("email channel (default, channel omitted) uses SYSTEM_PROMPT and the email_draft tool", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { subject: "Quick idea for Sunrise Bakery", body: "Hi Maria, ..." } }],
    });

    const result = await generateEmailDraft(BASE_INPUT);

    expect(result).toEqual({
      subject: "Quick idea for Sunrise Bakery",
      body: "Hi Maria, ...",
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe(SYSTEM_PROMPT);
    expect(callArgs.tools[0].name).toBe("email_draft");
    expect(callArgs.tools[0].input_schema.required).toEqual(["subject", "body"]);
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "email_draft" });
  });

  it("explicit channel: 'email' behaves identically to omitting channel", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { subject: "S", body: "B" } }],
    });

    await generateEmailDraft({ ...BASE_INPUT, channel: "email" });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe(SYSTEM_PROMPT);
    expect(callArgs.tools[0].name).toBe("email_draft");
  });

  it("facebook channel selects SOCIAL_DM_SYSTEM_PROMPT and the message_draft tool", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { body: "Hey! Loved the pandesal photos on your page." } }],
    });

    const result = await generateEmailDraft({ ...BASE_INPUT, channel: "facebook" });

    expect(result).toEqual({
      subject: "",
      body: "Hey! Loved the pandesal photos on your page.",
    });
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe(SOCIAL_DM_SYSTEM_PROMPT);
    expect(callArgs.tools[0].name).toBe("message_draft");
    expect(callArgs.tools[0].input_schema.required).toEqual(["body"]);
    expect(callArgs.tools[0].input_schema.properties.subject).toBeUndefined();
    expect(callArgs.tool_choice).toEqual({ type: "tool", name: "message_draft" });
  });

  it("instagram channel also selects SOCIAL_DM_SYSTEM_PROMPT and the message_draft tool", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { body: "Hi! Quick idea for your account." } }],
    });

    const result = await generateEmailDraft({ ...BASE_INPUT, channel: "instagram" });

    expect(result.subject).toBe("");
    expect(result.body).toBe("Hi! Quick idea for your account.");
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe(SOCIAL_DM_SYSTEM_PROMPT);
    expect(callArgs.tools[0].name).toBe("message_draft");
  });

  it("phone channel selects PHONE_SCRIPT_SYSTEM_PROMPT and the message_draft tool", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { body: "Hi, this is Alex calling about your bakery's socials — got 30 seconds?" } }],
    });

    const result = await generateEmailDraft({ ...BASE_INPUT, channel: "phone" });

    expect(result).toEqual({
      subject: "",
      body: "Hi, this is Alex calling about your bakery's socials — got 30 seconds?",
    });
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe(PHONE_SCRIPT_SYSTEM_PROMPT);
    expect(callArgs.tools[0].name).toBe("message_draft");
  });

  it("non-email channels never require or read a subject from the model", async () => {
    // Model returns a subject anyway (e.g. it ignored instructions) — the
    // non-email path must not surface it; result.subject is always "".
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { subject: "Leaked subject", body: "Body text" } }],
    });

    const result = await generateEmailDraft({ ...BASE_INPUT, channel: "facebook" });
    expect(result.subject).toBe("");
    expect(result.body).toBe("Body text");
  });

  it("throws a clear error when a non-email response has an empty body", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { body: "   " } }],
    });

    await expect(generateEmailDraft({ ...BASE_INPUT, channel: "phone" })).rejects.toThrow(
      /empty body/i
    );
  });

  it("does NOT run the email path's empty-subject check on the non-email path", async () => {
    // A body-only response with no subject field at all must not throw an
    // "empty subject" error — there is no subject to fill on this path.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { body: "A perfectly fine DM body." } }],
    });

    await expect(
      generateEmailDraft({ ...BASE_INPUT, channel: "instagram" })
    ).resolves.toEqual({ subject: "", body: "A perfectly fine DM body." });
  });

  it("still throws on empty subject for the email channel (regression guard)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { subject: "   ", body: "Body text" } }],
    });

    await expect(generateEmailDraft(BASE_INPUT)).rejects.toThrow(/empty subject/i);
  });

  it("still throws on empty body for the email channel (regression guard)", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "tool_use", input: { subject: "Subject", body: "   " } }],
    });

    await expect(generateEmailDraft(BASE_INPUT)).rejects.toThrow(/empty body/i);
  });
});

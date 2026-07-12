/**
 * Unit tests for buildUserMessage in src/lib/draft.ts.
 *
 * Tests:
 *   (a) no feedback / previousAttempt → output identical to prior behaviour
 *   (b) with feedback + previousAttempt → message contains rejection section
 *
 * Does NOT call the Anthropic API — only the pure buildUserMessage helper is tested.
 */

import { describe, it, expect } from "vitest";
import { buildUserMessage } from "@/lib/draft";
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

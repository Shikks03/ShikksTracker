/**
 * Unit tests for pure helpers in src/lib/replies.ts.
 *
 * These helpers were private; they were given named exports (with "treat as
 * internal" comments) solely to make them testable without refactoring.
 *
 * Known-bug pins are clearly commented with the fixing task number so the
 * suite stays green today and the fix task flips the expectation.
 */

import { describe, it, expect } from "vitest";
import {
  stripQuotedText,
  makeSnippet,
  isOptOut,
  isGmailReaction,
} from "@/lib/replies";

// ---------------------------------------------------------------------------
// stripQuotedText
// ---------------------------------------------------------------------------

describe("stripQuotedText", () => {
  it("returns plain text unchanged", () => {
    const input = "Thanks, I am interested!";
    expect(stripQuotedText(input)).toBe("Thanks, I am interested!");
  });

  it("strips lines starting with >", () => {
    const input = "Yes I want to know more\n> On Jul 4 wrote:\n> previous content";
    const result = stripQuotedText(input);
    expect(result).toBe("Yes I want to know more");
  });

  it("stops at 'On ... wrote:' attribution line", () => {
    const input =
      "Thanks for reaching out.\n\nOn Mon, Jul 4, 2026 at 9:00 AM Your Name <you@example.com> wrote:\n> previous email text";
    const result = stripQuotedText(input);
    expect(result).toBe("Thanks for reaching out.\n");
  });

  it("preserves lines before quoted block and drops lines starting with >", () => {
    const input = "I would like to unsubscribe\n> Original message\n> More context";
    const result = stripQuotedText(input);
    // Only drops the lines starting with >
    expect(result).toBe("I would like to unsubscribe");
  });

  it("returns empty string when input is empty", () => {
    expect(stripQuotedText("")).toBe("");
  });

  it("handles text with no quoted content", () => {
    const input = "Line 1\nLine 2\nLine 3";
    expect(stripQuotedText(input)).toBe("Line 1\nLine 2\nLine 3");
  });

  it("preserves lines with > that are not at line start (trimStart)", () => {
    // Only lines where trimStart() starts with ">" are dropped
    const input = "I use > for quoting in Markdown\n> actual quote";
    // "I use > for quoting..." does NOT start with > after trimStart
    // "> actual quote" DOES start with > after trimStart
    const result = stripQuotedText(input);
    expect(result).toBe("I use > for quoting in Markdown");
  });
});

// ---------------------------------------------------------------------------
// makeSnippet
// ---------------------------------------------------------------------------

describe("makeSnippet", () => {
  it("returns null for empty string", () => {
    expect(makeSnippet("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(makeSnippet("   \n\t  ")).toBeNull();
  });

  it("collapses whitespace and newlines to single spaces", () => {
    const input = "Thanks  for\nreaching  out";
    expect(makeSnippet(input)).toBe("Thanks for reaching out");
  });

  it("returns the full text when 80 chars or fewer", () => {
    const input = "A".repeat(80);
    const result = makeSnippet(input);
    expect(result).toBe("A".repeat(80));
    expect(result?.length).toBe(80);
  });

  it("truncates to 80 chars and appends ellipsis when longer", () => {
    const input = "A".repeat(81);
    const result = makeSnippet(input);
    expect(result).toBe("A".repeat(80) + "…");
    expect(result?.length).toBe(81); // 80 chars + 1 Unicode ellipsis char
  });

  it("trims leading/trailing whitespace before measuring", () => {
    const input = "  hello  ";
    expect(makeSnippet(input)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// isOptOut
// ---------------------------------------------------------------------------

describe("isOptOut", () => {
  // --- True positives ---

  it("detects 'STOP' keyword (case-insensitive)", () => {
    expect(isOptOut("STOP")).toBe(true);
  });

  it("detects 'stop' keyword", () => {
    expect(isOptOut("Please stop emailing me.")).toBe(true);
  });

  it("detects 'unsubscribe' keyword", () => {
    expect(isOptOut("I want to unsubscribe from your list.")).toBe(true);
  });

  it("detects 'UNSUBSCRIBE' (case-insensitive)", () => {
    expect(isOptOut("UNSUBSCRIBE")).toBe(true);
  });

  it("detects 'opt out' with space", () => {
    expect(isOptOut("Please opt out of further emails.")).toBe(true);
  });

  it("detects 'opt-out' with hyphen", () => {
    expect(isOptOut("I want to opt-out.")).toBe(true);
  });

  it("detects 'optout' without separator", () => {
    expect(isOptOut("optout please")).toBe(true);
  });

  // --- False positives (KNOWN BUGS — Task 3.2 will fix) ---

  it("CURRENT BEHAVIOR: falsely flags 'stop by our office' as opt-out (Task 3.2 fixes \\bstop\\b false positives)", () => {
    // BUG: \bstop\b matches 'stop' in 'stop by our office next week'
    // Task 3.2 will replace \bstop\b with a more specific pattern
    // This test asserts CURRENT behavior so the suite stays green.
    expect(isOptOut("stop by our office next week")).toBe(true);
  });

  it("CURRENT BEHAVIOR: falsely flags 'please stop by' as opt-out (Task 3.2 fixes)", () => {
    // Another \bstop\b false positive — 'stop by' is directional, not opt-out
    expect(isOptOut("please stop by when you get a chance")).toBe(true);
  });

  // --- True negatives ---

  it("does not flag a normal positive reply", () => {
    expect(isOptOut("Hi, I'd love to learn more about your offer!")).toBe(false);
  });

  it("does not flag an empty string", () => {
    expect(isOptOut("")).toBe(false);
  });

  it("strips quoted text before checking — STOP in quoted block does not trigger", () => {
    // The quoted footer line "just reply STOP" should be stripped before matching
    const withQuotedStop =
      "Thanks for reaching out!\n\n> On Jul 4 wrote:\n> If you'd rather not hear from me, just reply STOP.";
    expect(isOptOut(withQuotedStop)).toBe(false);
  });

  it("strips quoted text before checking — unsubscribe in quoted block does not trigger", () => {
    const withQuotedUnsub =
      "Sounds good!\n\n> On Jul 4 wrote:\n> If you want to unsubscribe, reply STOP.";
    expect(isOptOut(withQuotedUnsub)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isGmailReaction
// ---------------------------------------------------------------------------

describe("isGmailReaction", () => {
  it("detects utm_campaign=emojireactionemail", () => {
    const body =
      '<a href="https://example.com?utm_campaign=emojireactionemail">view</a>';
    expect(isGmailReaction(body)).toBe(true);
  });

  it("detects 'reacted via Gmail' phrase", () => {
    const body = "Someone reacted via Gmail with 👍";
    expect(isGmailReaction(body)).toBe(true);
  });

  it("is case-insensitive for utm_campaign match", () => {
    const body = "utm_campaign=EmojiReactionEmail";
    expect(isGmailReaction(body)).toBe(true);
  });

  it("is case-insensitive for 'reacted via gmail'", () => {
    const body = "reacted via GMAIL";
    expect(isGmailReaction(body)).toBe(true);
  });

  it("returns false for a normal reply body", () => {
    const body = "Thanks for reaching out! Let me check with my team.";
    expect(isGmailReaction(body)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGmailReaction("")).toBe(false);
  });

  it("returns false for a body that mentions gmail but not the reaction phrase", () => {
    const body = "I got your email via gmail and I'm interested.";
    expect(isGmailReaction(body)).toBe(false);
  });
});

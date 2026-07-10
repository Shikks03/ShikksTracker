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
  extractFromAddress,
} from "@/lib/replies";

// ---------------------------------------------------------------------------
// extractFromAddress
// ---------------------------------------------------------------------------

describe("extractFromAddress", () => {
  it("returns a bare address unchanged (lowercased)", () => {
    expect(extractFromAddress("ana@x.com")).toBe("ana@x.com");
  });

  it("extracts address from 'Name <addr>' form", () => {
    expect(extractFromAddress("Ana Reyes <ana@x.com>")).toBe("ana@x.com");
  });

  it("extracts address from '\"Quoted Name\" <addr>' form", () => {
    expect(extractFromAddress('"Quoted Name" <ana@x.com>')).toBe("ana@x.com");
  });

  it("handles extra whitespace inside angle brackets", () => {
    expect(extractFromAddress("Ana <  ana@x.com  >")).toBe("ana@x.com");
  });

  it("lowercases the result for bare addresses", () => {
    expect(extractFromAddress("ANA@X.COM")).toBe("ana@x.com");
  });

  it("lowercases the result for angle-bracket addresses", () => {
    expect(extractFromAddress("Ana Reyes <ANA@X.COM>")).toBe("ana@x.com");
  });

  it("trims surrounding whitespace on bare addresses", () => {
    expect(extractFromAddress("  ana@x.com  ")).toBe("ana@x.com");
  });

  it("does NOT match lana@x.com against contact ana@x.com (the bug fix)", () => {
    // This tests the exact false-positive the fix eliminates:
    // includes("ana@x.com") would have returned true for "lana@x.com"
    const extracted = extractFromAddress("lana@x.com");
    expect(extracted === "ana@x.com").toBe(false);
    expect(extracted).toBe("lana@x.com");
  });
});

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
  // ---------------------------------------------------------------------------
  // Whole-message equality matches (single-word / short opt-out commands)
  // ---------------------------------------------------------------------------

  it("whole-message 'STOP' (uppercase) → true", () => {
    expect(isOptOut("STOP")).toBe(true);
  });

  it("whole-message 'Stop.' (capitalised, trailing period) → true", () => {
    expect(isOptOut("Stop.")).toBe(true);
  });

  it("whole-message 'stop!' (trailing exclamation) → true", () => {
    expect(isOptOut("stop!")).toBe(true);
  });

  it("whole-message 'unsubscribe' → true", () => {
    expect(isOptOut("unsubscribe")).toBe(true);
  });

  it("whole-message 'UNSUBSCRIBE' (case-insensitive) → true", () => {
    expect(isOptOut("UNSUBSCRIBE")).toBe(true);
  });

  it("whole-message 'opt out' → true", () => {
    expect(isOptOut("opt out")).toBe(true);
  });

  it("whole-message 'opt-out' → true", () => {
    expect(isOptOut("opt-out")).toBe(true);
  });

  it("whole-message with surrounding whitespace → true", () => {
    expect(isOptOut("  stop  ")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Other explicit opt-out forms (intent patterns catch these mid-sentence too)
  // ---------------------------------------------------------------------------

  it("'optout please' → true (opt[ -]?out pattern matches no-separator form)", () => {
    expect(isOptOut("optout please")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Intent-phrase matches (explicit opt-out intent anywhere in the text)
  // ---------------------------------------------------------------------------

  it("'please remove me from your list' → true", () => {
    expect(isOptOut("please remove me from your list")).toBe(true);
  });

  it("'not interested, please unsubscribe me' → true", () => {
    expect(isOptOut("not interested, please unsubscribe me")).toBe(true);
  });

  it("'do not email me again' → true", () => {
    expect(isOptOut("do not email me again")).toBe(true);
  });

  it("'do not contact me' → true", () => {
    expect(isOptOut("do not contact me")).toBe(true);
  });

  it("'stop emailing me' → true", () => {
    expect(isOptOut("stop emailing me")).toBe(true);
  });

  it("'stop contacting me' → true", () => {
    expect(isOptOut("stop contacting me")).toBe(true);
  });

  it("'Please stop emailing me.' → true (intent phrase with punctuation)", () => {
    expect(isOptOut("Please stop emailing me.")).toBe(true);
  });

  it("'I want to unsubscribe from your list.' → true", () => {
    expect(isOptOut("I want to unsubscribe from your list.")).toBe(true);
  });

  it("'Please opt out of further emails.' → true", () => {
    expect(isOptOut("Please opt out of further emails.")).toBe(true);
  });

  it("'I want to opt-out.' → true", () => {
    expect(isOptOut("I want to opt-out.")).toBe(true);
  });

  it("'remove me from your list' → true", () => {
    expect(isOptOut("remove me from your list")).toBe(true);
  });

  it("'opt me out please' → true", () => {
    expect(isOptOut("opt me out please")).toBe(true);
  });

  it("'take me off your mailing list' → true", () => {
    expect(isOptOut("take me off your mailing list")).toBe(true);
  });

  it("'take me off this list' → true", () => {
    expect(isOptOut("take me off this list")).toBe(true);
  });

  it("'please take me off your list' → true", () => {
    expect(isOptOut("please take me off your list")).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // False positives fixed — these were incorrectly flagged by the old \bstop\b pattern
  // ---------------------------------------------------------------------------

  it("'stop by our office next week' → false (directional 'stop by', not opt-out)", () => {
    expect(isOptOut("stop by our office next week")).toBe(false);
  });

  it("'please stop by when you get a chance' → false (directional 'stop by', not opt-out)", () => {
    expect(isOptOut("please stop by when you get a chance")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // True negatives — normal business replies that must NOT trigger opt-out
  // ---------------------------------------------------------------------------

  it("'we should stop by sometime' → false", () => {
    expect(isOptOut("we should stop by sometime")).toBe(false);
  });

  it("'one-stop shop' → false", () => {
    expect(isOptOut("we're a one-stop shop for all your needs")).toBe(false);
  });

  it("\"I can't stop thinking about this offer\" → false", () => {
    expect(isOptOut("I can't stop thinking about this offer")).toBe(false);
  });

  it("\"don't stop the campaign\" → false", () => {
    expect(isOptOut("don't stop the campaign")).toBe(false);
  });

  it("does not flag a normal positive reply", () => {
    expect(isOptOut("Hi, I'd love to learn more about your offer!")).toBe(false);
  });

  it("does not flag an empty string", () => {
    expect(isOptOut("")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Quoted-text stripping ensures our own email footer doesn't self-trigger
  // ---------------------------------------------------------------------------

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

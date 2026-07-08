/**
 * Unit tests for bodyToHtml in src/lib/draft.ts.
 *
 * bodyToHtml is a pure function. Importing the module also imports
 * @anthropic-ai/sdk, but no API calls or env assertions happen at import
 * time (the env check is inside getClient() which is only called by
 * generateEmailDraft). So import is safe without mocking.
 *
 * Covers: HTML escaping, paragraph structure (<p>), single-newline → <br>,
 * Windows CRLF normalisation, empty-paragraph filtering, and plain text
 * passthrough.
 */

import { describe, it, expect } from "vitest";
import { bodyToHtml } from "@/lib/draft";

describe("bodyToHtml", () => {
  // ---------------------------------------------------------------------------
  // Basic paragraph structure
  // ---------------------------------------------------------------------------

  it("wraps a single paragraph in <p>...</p>", () => {
    expect(bodyToHtml("Hello world")).toBe("<p>Hello world</p>");
  });

  it("splits double newlines into separate <p> elements", () => {
    const input = "First paragraph.\n\nSecond paragraph.";
    expect(bodyToHtml(input)).toBe(
      "<p>First paragraph.</p>\n<p>Second paragraph.</p>"
    );
  });

  it("converts single newlines within a paragraph to <br>", () => {
    const input = "Line one\nLine two\nLine three";
    expect(bodyToHtml(input)).toBe("<p>Line one<br>Line two<br>Line three</p>");
  });

  it("handles three or more consecutive newlines as a paragraph break", () => {
    // split(/\n\n+/) — three newlines still splits into two paragraphs
    const input = "Para 1\n\n\nPara 2";
    expect(bodyToHtml(input)).toBe("<p>Para 1</p>\n<p>Para 2</p>");
  });

  // ---------------------------------------------------------------------------
  // HTML escaping
  // ---------------------------------------------------------------------------

  it("escapes & in body text", () => {
    expect(bodyToHtml("Jack & Jill")).toBe("<p>Jack &amp; Jill</p>");
  });

  it("escapes < and > in body text", () => {
    expect(bodyToHtml("5 < 10 > 3")).toBe("<p>5 &lt; 10 &gt; 3</p>");
  });

  it("escapes double-quote in body text", () => {
    expect(bodyToHtml('He said "hello"')).toBe(
      "<p>He said &quot;hello&quot;</p>"
    );
  });

  it("escapes single-quote in body text", () => {
    expect(bodyToHtml("it's fine")).toBe("<p>it&#39;s fine</p>");
  });

  it("escapes HTML in a realistic email body", () => {
    const input = "Hi <Juan>,\n\nCheck https://example.com & reply!";
    // Note: < and > and & are all escaped; the URL is NOT wrapped in an anchor
    // (bodyToHtml doesn't do URL rewriting — that is tracking.ts's job)
    const result = bodyToHtml(input);
    expect(result).toBe(
      "<p>Hi &lt;Juan&gt;,</p>\n<p>Check https://example.com &amp; reply!</p>"
    );
  });

  // ---------------------------------------------------------------------------
  // Windows CRLF normalisation
  // ---------------------------------------------------------------------------

  it("normalises Windows CRLF line endings", () => {
    const input = "Line 1\r\nLine 2";
    expect(bodyToHtml(input)).toBe("<p>Line 1<br>Line 2</p>");
  });

  it("normalises CRLF paragraph breaks", () => {
    const input = "Para 1\r\n\r\nPara 2";
    expect(bodyToHtml(input)).toBe("<p>Para 1</p>\n<p>Para 2</p>");
  });

  it("normalises bare CR endings", () => {
    const input = "Line 1\rLine 2";
    expect(bodyToHtml(input)).toBe("<p>Line 1<br>Line 2</p>");
  });

  // ---------------------------------------------------------------------------
  // Empty paragraph filtering
  // ---------------------------------------------------------------------------

  it("filters out empty paragraphs from double-blank lines", () => {
    const input = "Para 1\n\n\n\nPara 2";
    // Extra blank lines produce empty para candidates that get filtered
    expect(bodyToHtml(input)).toBe("<p>Para 1</p>\n<p>Para 2</p>");
  });

  it("does not produce empty <p></p> for trailing newlines", () => {
    const input = "Hello\n\n";
    const result = bodyToHtml(input);
    expect(result).not.toContain("<p></p>");
    expect(result).toBe("<p>Hello</p>");
  });

  it("trims whitespace from each paragraph", () => {
    const input = "  Hello  \n\n  World  ";
    // para.trim() is called before escaping
    expect(bodyToHtml(input)).toBe("<p>Hello</p>\n<p>World</p>");
  });

  // ---------------------------------------------------------------------------
  // Realistic email body
  // ---------------------------------------------------------------------------

  it("converts a typical 3-paragraph cold email body", () => {
    const input = [
      "Hi Maria,",
      "",
      "I noticed Sunrise Bakery has been expanding — congratulations on the new branch!",
      "",
      "We help small food businesses streamline their delivery operations. Would love to share how.",
      "",
      "If you'd rather not hear from me, just reply STOP.",
    ].join("\n");

    const result = bodyToHtml(input);
    expect(result).toBe(
      "<p>Hi Maria,</p>\n" +
        "<p>I noticed Sunrise Bakery has been expanding — congratulations on the new branch!</p>\n" +
        "<p>We help small food businesses streamline their delivery operations. Would love to share how.</p>\n" +
        "<p>If you&#39;d rather not hear from me, just reply STOP.</p>"
    );
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it("returns empty string for empty input", () => {
    expect(bodyToHtml("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    // All paragraphs become "<p></p>" after trim, which get filtered
    expect(bodyToHtml("   \n\n   ")).toBe("");
  });
});

/**
 * Unit tests for src/lib/tracking.ts.
 *
 * Covers: extractAndRewriteLinks (dedupe, trailing punctuation),
 * renderTrackedHtml (HTML escaping, anchor injection, paragraph/<br>
 * structure, pixel append, APP_BASE_URL set/unset).
 *
 * process.env.APP_BASE_URL is saved/restored around each test that needs it.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { extractAndRewriteLinks, renderTrackedHtml, htmlEscape } from "@/lib/tracking";

// ---------------------------------------------------------------------------
// htmlEscape
// ---------------------------------------------------------------------------

describe("htmlEscape", () => {
  it("escapes &", () => {
    expect(htmlEscape("a & b")).toBe("a &amp; b");
  });

  it("escapes <", () => {
    expect(htmlEscape("<script>")).toBe("&lt;script&gt;");
  });

  it("escapes >", () => {
    expect(htmlEscape("1 > 0")).toBe("1 &gt; 0");
  });

  it('escapes "', () => {
    expect(htmlEscape('"hello"')).toBe("&quot;hello&quot;");
  });

  it("escapes '", () => {
    expect(htmlEscape("it's")).toBe("it&#39;s");
  });

  it("returns plain text unchanged", () => {
    expect(htmlEscape("hello world")).toBe("hello world");
  });

  it("escapes all special chars in one string", () => {
    expect(htmlEscape(`<a href="x" data-v='y'>a & b</a>`)).toBe(
      "&lt;a href=&quot;x&quot; data-v=&#39;y&#39;&gt;a &amp; b&lt;/a&gt;"
    );
  });
});

// ---------------------------------------------------------------------------
// extractAndRewriteLinks
// ---------------------------------------------------------------------------

describe("extractAndRewriteLinks", () => {
  it("returns empty links array when body has no URLs", () => {
    const { links } = extractAndRewriteLinks("No URLs here at all.");
    expect(links).toHaveLength(0);
  });

  it("extracts a single http URL", () => {
    const { links } = extractAndRewriteLinks(
      "Check out http://example.com for details."
    );
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("http://example.com");
    expect(links[0].trackingId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("extracts a single https URL", () => {
    const { links } = extractAndRewriteLinks("Visit https://example.com today.");
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
  });

  it("deduplicates the same URL appearing twice — one trackingId", () => {
    const body =
      "Visit https://example.com and also https://example.com again.";
    const { links } = extractAndRewriteLinks(body);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
  });

  it("deduplicates across different positions in the text", () => {
    const body =
      "First: https://a.com, second: https://b.com, third: https://a.com";
    const { links } = extractAndRewriteLinks(body);
    expect(links).toHaveLength(2);
    const urls = links.map((l) => l.url).sort();
    expect(urls).toEqual(["https://a.com", "https://b.com"]);
  });

  it("assigns different trackingIds to different URLs", () => {
    const body = "See https://foo.com and https://bar.com";
    const { links } = extractAndRewriteLinks(body);
    expect(links).toHaveLength(2);
    expect(links[0].trackingId).not.toBe(links[1].trackingId);
  });

  it("strips trailing period from URL", () => {
    const { links } = extractAndRewriteLinks("Visit https://example.com.");
    expect(links[0].url).toBe("https://example.com");
  });

  it("strips trailing comma from URL", () => {
    const { links } = extractAndRewriteLinks("Go to https://example.com, then continue.");
    expect(links[0].url).toBe("https://example.com");
  });

  it("strips trailing semicolon from URL", () => {
    const { links } = extractAndRewriteLinks("Visit https://example.com;");
    expect(links[0].url).toBe("https://example.com");
  });

  it("strips trailing exclamation mark from URL", () => {
    const { links } = extractAndRewriteLinks("Check https://example.com!");
    expect(links[0].url).toBe("https://example.com");
  });

  it("strips trailing closing paren from URL", () => {
    const { links } = extractAndRewriteLinks("(See https://example.com)");
    expect(links[0].url).toBe("https://example.com");
  });

  it("preserves URL path, query, and fragment", () => {
    const { links } = extractAndRewriteLinks(
      "https://example.com/path?q=1&r=2#section"
    );
    expect(links[0].url).toBe("https://example.com/path?q=1&r=2#section");
  });
});

// ---------------------------------------------------------------------------
// renderTrackedHtml
// ---------------------------------------------------------------------------

describe("renderTrackedHtml", () => {
  const savedEnv: string | undefined = process.env.APP_BASE_URL;

  afterEach(() => {
    // Restore APP_BASE_URL after each test
    if (savedEnv === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = savedEnv;
    }
  });

  // --- APP_BASE_URL guard ---

  it("throws when APP_BASE_URL is unset and tracking pixel is requested", () => {
    delete process.env.APP_BASE_URL;
    expect(() => renderTrackedHtml("Hello", [], "pixel-id-123")).toThrow(
      "APP_BASE_URL"
    );
  });

  it("throws when APP_BASE_URL is unset and links are provided", () => {
    delete process.env.APP_BASE_URL;
    const links = [{ url: "https://example.com", trackingId: "abc-123" }];
    expect(() => renderTrackedHtml("Visit https://example.com", links, null)).toThrow(
      "APP_BASE_URL"
    );
  });

  it("does NOT throw when APP_BASE_URL is unset but no links and no pixel", () => {
    delete process.env.APP_BASE_URL;
    // Plain text, no links, no pixel — should succeed
    const html = renderTrackedHtml("Hello world", [], null);
    expect(html).toBe("<p>Hello world</p>");
  });

  // --- HTML escaping ---

  it("HTML-escapes special characters in plain text", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("5 < 10 & 3 > 1", [], null);
    expect(html).toContain("5 &lt; 10 &amp; 3 &gt; 1");
  });

  // --- Paragraph structure ---

  it("wraps a single paragraph in <p>...</p>", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Hello world", [], null);
    expect(html).toBe("<p>Hello world</p>");
  });

  it("splits double newlines into separate <p> elements", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Para one\n\nPara two", [], null);
    expect(html).toBe("<p>Para one</p>\n<p>Para two</p>");
  });

  it("converts single newlines within a paragraph to <br>", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Line 1\nLine 2", [], null);
    expect(html).toBe("<p>Line 1<br>Line 2</p>");
  });

  it("normalises Windows CRLF line endings", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Line 1\r\nLine 2\r\n\r\nPara 2", [], null);
    expect(html).toBe("<p>Line 1<br>Line 2</p>\n<p>Para 2</p>");
  });

  it("skips empty paragraphs (blank lines between content)", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Para 1\n\n\n\nPara 2", [], null);
    // Extra blank lines form empty paragraphs that are filtered out
    expect(html).toBe("<p>Para 1</p>\n<p>Para 2</p>");
  });

  // --- Tracking pixel ---

  it("appends the tracking pixel when trackingPixelId is set", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Hello", [], "pixel-abc");
    expect(html).toContain(
      '<img src="https://app.example.com/api/track/open/pixel-abc" width="1" height="1" alt="" style="display:none">'
    );
  });

  it("appends pixel after the last paragraph", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Hello\n\nWorld", [], "px-1");
    const pixelLine =
      '\n<img src="https://app.example.com/api/track/open/px-1" width="1" height="1" alt="" style="display:none">';
    expect(html).toBe(`<p>Hello</p>\n<p>World</p>${pixelLine}`);
  });

  it("does not append pixel when trackingPixelId is null", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const html = renderTrackedHtml("Hello", [], null);
    expect(html).not.toContain("<img");
  });

  // --- Anchor injection ---

  it("rewrites a URL to a tracking anchor", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const links = [{ url: "https://target.com", trackingId: "track-123" }];
    const html = renderTrackedHtml("Visit https://target.com today.", links, null);
    expect(html).toContain(
      '<a href="https://app.example.com/api/track/click/track-123">https://target.com</a>'
    );
  });

  it("preserves trailing punctuation as text after the anchor", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const links = [{ url: "https://example.com", trackingId: "t1" }];
    const html = renderTrackedHtml("Go to https://example.com.", links, null);
    // The period should appear outside the anchor
    expect(html).toContain(
      '<a href="https://app.example.com/api/track/click/t1">https://example.com</a>.'
    );
  });

  it("renders URL as plain escaped text when it has no matching tracking entry", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    // No links provided — URL in body becomes plain escaped text
    const html = renderTrackedHtml("Visit https://example.com", [], null);
    // Should NOT contain an <a> tag, just the URL as text
    expect(html).not.toContain("<a ");
    expect(html).toContain("https://example.com");
  });

  it("renders multiple URLs as separate anchors", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const links = [
      { url: "https://foo.com", trackingId: "t-foo" },
      { url: "https://bar.com", trackingId: "t-bar" },
    ];
    const html = renderTrackedHtml(
      "See https://foo.com and https://bar.com",
      links,
      null
    );
    expect(html).toContain(
      '<a href="https://app.example.com/api/track/click/t-foo">https://foo.com</a>'
    );
    expect(html).toContain(
      '<a href="https://app.example.com/api/track/click/t-bar">https://bar.com</a>'
    );
  });
});

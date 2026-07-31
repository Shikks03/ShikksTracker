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
import {
  extractAndRewriteLinks,
  renderTrackedHtml,
  htmlEscape,
  safeRedirectUrl,
} from "@/lib/tracking";

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
// extractAndRewriteLinks — unsubscribe URL exclusion (Task 6.2)
// ---------------------------------------------------------------------------

describe("extractAndRewriteLinks — unsubscribe URL exclusion", () => {
  const SAVED_BASE = process.env.APP_BASE_URL;

  afterEach(() => {
    if (SAVED_BASE === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = SAVED_BASE;
    }
  });

  it("excludes an own-domain /api/unsubscribe/ URL from tracking", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const token = "550e8400-e29b-41d4-a716-446655440000";
    const body = `Please visit https://app.example.com/api/unsubscribe/${token} to opt out.`;
    const { links } = extractAndRewriteLinks(body);
    const urls = links.map((l) => l.url);
    expect(urls).not.toContain(`https://app.example.com/api/unsubscribe/${token}`);
    expect(links).toHaveLength(0);
  });

  it("tracks a normal URL while excluding an unsubscribe URL from the same body", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const token = "550e8400-e29b-41d4-a716-446655440000";
    const body = [
      "Check out https://mybusiness.com for more info.",
      "",
      `Unsubscribe: https://app.example.com/api/unsubscribe/${token}`,
    ].join("\n");
    const { links } = extractAndRewriteLinks(body);
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://mybusiness.com");
    expect(urls).not.toContain(`https://app.example.com/api/unsubscribe/${token}`);
    expect(links).toHaveLength(1);
  });

  it("does NOT exclude an /api/unsubscribe/ URL from a different domain", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const body = "Unsubscribe here: https://evil.com/api/unsubscribe/sometoken";
    const { links } = extractAndRewriteLinks(body);
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://evil.com/api/unsubscribe/sometoken");
    expect(links).toHaveLength(1);
  });

  it("excludes the unsubscribe URL when APP_BASE_URL has a path prefix", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const token = "abc-def-123";
    const body = `Opt out: https://app.example.com/api/unsubscribe/${token}`;
    const { links } = extractAndRewriteLinks(body);
    expect(links).toHaveLength(0);
  });

  it("falls back to tracking when APP_BASE_URL is unset (cannot determine own domain)", () => {
    // When APP_BASE_URL is missing, isUnsubscribeUrl returns false for all URLs,
    // so the unsubscribe URL is tracked like any other URL. This is an edge case
    // (APP_BASE_URL is required for sending) — tested to document the behaviour.
    delete process.env.APP_BASE_URL;
    const body = "Unsubscribe: https://app.example.com/api/unsubscribe/sometoken";
    const { links } = extractAndRewriteLinks(body);
    // Should have a tracking entry (cannot determine own domain without APP_BASE_URL)
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://app.example.com/api/unsubscribe/sometoken");
  });
});

// ---------------------------------------------------------------------------
// renderTrackedHtml — unsubscribe URL rendered as plain anchor (Task 6.2)
// ---------------------------------------------------------------------------

describe("renderTrackedHtml — unsubscribe URL as plain anchor", () => {
  const SAVED_BASE = process.env.APP_BASE_URL;

  afterEach(() => {
    if (SAVED_BASE === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = SAVED_BASE;
    }
  });

  it("renders the unsubscribe URL as a plain (non-click-tracked) anchor", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const token = "550e8400-e29b-41d4-a716-446655440000";
    const unsubUrl = `https://app.example.com/api/unsubscribe/${token}`;
    const body = `Hello there.\n\nUnsubscribe: ${unsubUrl}`;
    // extractAndRewriteLinks excludes the unsubscribe URL → no tracking entry
    const { links } = extractAndRewriteLinks(body);
    expect(links).toHaveLength(0);
    // renderTrackedHtml with empty links → URL has no trackingId → plain text fallback
    const html = renderTrackedHtml(body, links, null);
    // The unsubscribe URL must appear in the HTML but NOT wrapped in a click-redirect href
    expect(html).toContain(unsubUrl);
    expect(html).not.toContain("/api/track/click/");
  });

  it("renders a normal URL as tracked anchor while unsubscribe URL stays plain", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    const token = "550e8400-e29b-41d4-a716-446655440000";
    const unsubUrl = `https://app.example.com/api/unsubscribe/${token}`;
    const normalUrl = "https://mybusiness.com";
    const body = `Visit ${normalUrl} for more.\n\nUnsubscribe: ${unsubUrl}`;
    const { links } = extractAndRewriteLinks(body);
    // Only the normal URL should be in links
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe(normalUrl);
    const html = renderTrackedHtml(body, links, null);
    // Normal URL → click-tracked anchor
    expect(html).toContain(`/api/track/click/${links[0].trackingId}`);
    // Unsubscribe URL → plain text (no click-tracking redirect)
    expect(html).toContain(unsubUrl);
    expect(html).not.toContain(`/api/track/click/`+ unsubUrl);
    // Crucially: the unsubscribe URL should not be wrapped in a tracked href
    const unsubscribeAnchorTracked = `href="https://app.example.com/api/track/click/`;
    expect(html).not.toContain(unsubscribeAnchorTracked + token);
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

  // --- Untracked rendering (formerly draft.ts bodyToHtml, removed Task 5.4) ---
  // renderTrackedHtml(body, [], null) is now the single paragraph/escape path.

  it("returns empty string for empty input", () => {
    expect(renderTrackedHtml("", [], null)).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(renderTrackedHtml("   \n\n   ", [], null)).toBe("");
  });

  it("escapes single-quote in body text", () => {
    process.env.APP_BASE_URL = "https://app.example.com";
    expect(renderTrackedHtml("it's fine", [], null)).toBe("<p>it&#39;s fine</p>");
  });

  it("does not produce empty <p></p> for trailing newlines", () => {
    const html = renderTrackedHtml("Hello\n\n", [], null);
    expect(html).not.toContain("<p></p>");
    expect(html).toBe("<p>Hello</p>");
  });
});

// ---------------------------------------------------------------------------
// safeRedirectUrl (Security hardening, Wave C — Task 2: open-redirect guard
// for /api/track/click, since EmailLog.links[].url has no protocol validator)
// ---------------------------------------------------------------------------

describe("safeRedirectUrl", () => {
  const fallback = "https://app.example.com";

  it("accepts a bare http:// URL", () => {
    expect(safeRedirectUrl("http://x.com", fallback)).toBe("http://x.com");
  });

  it("accepts an https:// URL with path and query string", () => {
    expect(safeRedirectUrl("https://x.com/a?b=c", fallback)).toBe(
      "https://x.com/a?b=c"
    );
  });

  it("rejects javascript: URLs", () => {
    expect(safeRedirectUrl("javascript:alert(1)", fallback)).toBe(fallback);
  });

  it("rejects data: URLs", () => {
    expect(safeRedirectUrl("data:text/html,x", fallback)).toBe(fallback);
  });

  it("rejects file: URLs", () => {
    expect(safeRedirectUrl("file:///etc/passwd", fallback)).toBe(fallback);
  });

  it("rejects an empty string", () => {
    expect(safeRedirectUrl("", fallback)).toBe(fallback);
  });

  it("rejects undefined", () => {
    expect(safeRedirectUrl(undefined, fallback)).toBe(fallback);
  });

  it("rejects a malformed URL without throwing", () => {
    expect(() => safeRedirectUrl("ht!tp://", fallback)).not.toThrow();
    expect(safeRedirectUrl("ht!tp://", fallback)).toBe(fallback);
  });
});

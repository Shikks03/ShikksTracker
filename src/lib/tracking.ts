/**
 * Email tracking utilities — Phase 7 (pixel) + Phase 8 (link rewriting)
 *
 * Design constraints:
 *   - No new npm packages. Uses Node built-in `crypto.randomUUID()`.
 *   - Bodies are stored as PLAIN TEXT; URLs appear as bare text (https://…).
 *   - This is the single plain-text → HTML renderer for the app. Call with
 *     `(body, [], null)` for the untracked representation (formerly the separate
 *     `bodyToHtml` in draft.ts, removed Task 5.4). It tokenises each line into
 *     url/non-url segments so that inserted <a> anchors are never double-escaped.
 */

import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// HTML escaping (mirrors draft.ts — kept here to avoid circular dep)
// ---------------------------------------------------------------------------

export function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// URL tokeniser
// ---------------------------------------------------------------------------

/**
 * Regex that matches URLs starting with http:// or https://.
 * Matches greedily until whitespace, then strips trailing punctuation
 * characters that are unlikely to be part of the URL (.,;:!?)).
 *
 * Capture group 1 = the URL.
 */
const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Strip trailing punctuation that commonly follows a URL in prose text. */
function stripTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)]+$/, "");
}

/**
 * Matches EmailLog's `LinkSchema.url` maxlength (src/models/EmailLog.ts).
 * URL_RE has no upper bound on match length (it runs until whitespace), so a
 * pathological body — e.g. a single spaceless run of characters starting
 * with "https://" inside AI-drafted or scraper-CSV-derived text — could
 * otherwise produce a `links` entry too long for the schema and throw a
 * ValidationError mid-send. Anything longer is simply not turned into a
 * tracked link; it still renders in the body as plain text (see
 * renderTrackedHtml's untracked-URL fallback).
 */
const MAX_TRACKED_URL_LEN = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Segment {
  type: "text" | "url";
  value: string;
}

type TrackingLink = { url: string; trackingId: string };

// ---------------------------------------------------------------------------
// extractAndRewriteLinks
// ---------------------------------------------------------------------------

/**
 * Returns true when a URL is the own-domain unsubscribe endpoint and should
 * NOT be click-tracked. We match on the path prefix rather than on the full
 * URL so the check works regardless of scheme, port, or env value.
 *
 * Rationale: click-tracking the unsubscribe link would (a) add a redirect hop
 * that might be flagged by spam filters, and (b) log a "click" event for an
 * unsubscribe action, corrupting engagement scores. The unsubscribe route
 * records the opt-out itself; no separate tracking needed.
 */
function isUnsubscribeUrl(url: string): boolean {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) return false;
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    return (
      parsed.hostname === base.hostname &&
      parsed.pathname.startsWith("/api/unsubscribe/")
    );
  } catch {
    return false;
  }
}

/**
 * Scans a plain-text body for URLs and returns one tracking entry per unique
 * URL. Duplicate URLs in the body share a single trackingId.
 *
 * Unsubscribe URLs (own-domain /api/unsubscribe/*) are deliberately excluded:
 * they must reach the recipient as plain anchors, not click-redirect links.
 * See isUnsubscribeUrl() above for rationale.
 */
export function extractAndRewriteLinks(body: string): { links: TrackingLink[] } {
  const urlMap = new Map<string, string>(); // url → trackingId

  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(body)) !== null) {
    const raw = match[1];
    const url = stripTrailingPunct(raw);
    if (
      url &&
      url.length <= MAX_TRACKED_URL_LEN &&
      !urlMap.has(url) &&
      !isUnsubscribeUrl(url)
    ) {
      urlMap.set(url, randomUUID());
    }
  }

  const links: TrackingLink[] = [];
  for (const [url, trackingId] of urlMap) {
    links.push({ url, trackingId });
  }

  return { links };
}

// ---------------------------------------------------------------------------
// safeRedirectUrl
// ---------------------------------------------------------------------------

/**
 * Validates a URL before it is used as a redirect target for
 * /api/track/click. `url` here comes straight out of `EmailLog.links[].url`
 * in the DB — and while `URL_RE` above restricts what gets WRITTEN there to
 * http(s), that only guards the AI-drafted-email write path. `keyPoints` is
 * built from imported scraper CSV (including a `website` column) and is fed
 * verbatim into the Claude prompt in sequence.ts, so a prompt-injected CSV
 * row could in principle plant a non-http(s) URL (`javascript:`, `data:`,
 * `file:`, etc.) that this endpoint would otherwise 302-redirect to,
 * silently turning our own domain into an open redirector.
 *
 * Returns `url` unchanged only when it parses as an absolute URL whose
 * protocol is exactly "http:" or "https:"; otherwise returns `fallback`.
 * `new URL()` throwing on a malformed string is caught, not propagated.
 *
 * Pure function — no DB, no Next.js types — safe to unit test directly.
 */
export function safeRedirectUrl(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// renderTrackedHtml
// ---------------------------------------------------------------------------

/**
 * Converts a plain-text email body to HTML, replacing URLs with tracking
 * anchor tags and optionally appending a 1×1 tracking pixel.
 *
 * Paragraph + line-break logic:
 *   - Double newlines → `<p>…</p>` paragraph breaks.
 *   - Single newlines within a paragraph → `<br>`.
 *
 * URL replacement:
 *   - Each URL occurrence becomes:
 *     `<a href="${APP_BASE_URL}/api/track/click/${trackingId}">${escapedUrl}</a>`
 *   - The display text is the original URL (HTML-escaped); the href is the
 *     tracking redirect.
 *   - Trailing punctuation stripped from the URL is preserved as literal text
 *     after the closing `</a>`.
 *
 * Pixel (when trackingPixelId is set):
 *   `<img src="${APP_BASE_URL}/api/track/open/${trackingPixelId}" width="1" height="1" alt="" style="display:none">`
 *   appended after the last paragraph.
 */
export function renderTrackedHtml(
  body: string,
  links: TrackingLink[],
  trackingPixelId: string | null
): string {
  const baseUrl = process.env.APP_BASE_URL;
  if ((links.length > 0 || trackingPixelId) && !baseUrl) {
    throw new Error(
      "APP_BASE_URL environment variable is not set. " +
        "It is required when tracking is applied to emails."
    );
  }

  // Build a lookup from url → trackingId for O(1) access during rendering.
  const linkMap = new Map<string, string>(links.map((l) => [l.url, l.trackingId]));

  // Normalise line endings
  const normalised = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  /**
   * Tokenise a single line into alternating text/url segments.
   * Trailing punctuation that was stripped from the URL is re-attached as a
   * text segment so it renders literally after the anchor.
   */
  function tokeniseLine(line: string): Segment[] {
    const segments: Segment[] = [];
    let lastIndex = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = URL_RE.exec(line)) !== null) {
      const rawUrl = match[1];
      const cleanUrl = stripTrailingPunct(rawUrl);
      const matchStart = match.index;
      const matchEnd = match.index + rawUrl.length;

      // Text before this URL
      if (matchStart > lastIndex) {
        segments.push({ type: "text", value: line.slice(lastIndex, matchStart) });
      }

      // URL segment (use cleaned URL as value)
      segments.push({ type: "url", value: cleanUrl });

      // Any stripped trailing punctuation becomes a text segment
      const stripped = rawUrl.slice(cleanUrl.length);
      if (stripped) {
        segments.push({ type: "text", value: stripped });
      }

      lastIndex = matchEnd;
    }

    // Remaining text after the last URL
    if (lastIndex < line.length) {
      segments.push({ type: "text", value: line.slice(lastIndex) });
    }

    return segments;
  }

  /**
   * Render a single paragraph's worth of lines.
   * Lines are joined with `<br>`, segments are escaped or converted to anchors.
   */
  function renderParagraphLines(lines: string[]): string {
    return lines
      .map((line) => {
        const segments = tokeniseLine(line);
        return segments
          .map((seg) => {
            if (seg.type === "text") {
              return htmlEscape(seg.value);
            }
            // URL segment
            const trackingId = linkMap.get(seg.value);
            const displayText = htmlEscape(seg.value);
            if (trackingId && baseUrl) {
              const href = `${baseUrl}/api/track/click/${trackingId}`;
              return `<a href="${href}">${displayText}</a>`;
            }
            // Fallback: no tracking entry found — render as plain escaped text
            return displayText;
          })
          .join("");
      })
      .join("<br>");
  }

  // Split into paragraphs (double newline), then each paragraph into lines
  const paragraphs = normalised
    .split(/\n\n+/)
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return null;
      const lines = trimmed.split("\n");
      const inner = renderParagraphLines(lines);
      return `<p>${inner}</p>`;
    })
    .filter((p): p is string => p !== null);

  let html = paragraphs.join("\n");

  // Append tracking pixel
  if (trackingPixelId && baseUrl) {
    const pixelSrc = `${baseUrl}/api/track/open/${trackingPixelId}`;
    html += `\n<img src="${pixelSrc}" width="1" height="1" alt="" style="display:none">`;
  }

  return html;
}

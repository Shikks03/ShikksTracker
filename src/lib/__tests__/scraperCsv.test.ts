/**
 * Unit tests for src/lib/scraperCsv.ts — the "Maps Lead Scraper" CSV parser,
 * deterministic keyPoints builder, and channel derivation.
 *
 * Covers: full 29-column parse, the BOM regression guard, CRLF line endings,
 * header case/whitespace tolerance, missing `name` handling, partial-column
 * CSVs, keyPoints segment composition, and deriveChannel fallback order.
 */

import { describe, it, expect } from "vitest";
import {
  parseScraperCsv,
  buildScraperKeyPoints,
  deriveChannel,
  parseRecentReviewDays,
  ScraperRow,
} from "@/lib/scraperCsv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRAPER_HEADERS = [
  "name",
  "web_presence_tier",
  "has_website",
  "claimed",
  "rating",
  "review_count",
  "recent_review",
  "category",
  "price",
  "open_status",
  "list_address",
  "full_address",
  "located_in",
  "plus_code",
  "website",
  "facebook",
  "instagram",
  "phone",
  "hours",
  "menu_url",
  "lat",
  "lng",
  "place_url",
  "place_id",
  "tag",
  "search_query",
  "captured_at",
  "enrich_status",
  "enrich_error",
];

/** CSV-quote a field if it contains a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function makeScraperCsv(headers: string[], rows: string[][]): string {
  return [
    headers.map(csvField).join(","),
    ...rows.map((r) => r.map(csvField).join(",")),
  ].join("\n");
}

/**
 * A full, realistic data row. Defaults to the 29-column SCRAPER_HEADERS
 * order; pass `headers: SCRAPER_HEADERS_V31` (via overrides handling below)
 * to build a 31-column row instead.
 */
function fullDataRow(
  overrides: Record<string, string> = {},
  headers: string[] = SCRAPER_HEADERS
): string[] {
  const defaults: Record<string, string> = {
    name: "Sunrise Cafe",
    web_presence_tier: "SOCIAL_ONLY",
    has_website: "no",
    claimed: "unclaimed",
    rating: "4.5",
    review_count: "1234",
    recent_review: "Great coffee and friendly staff, will come back again soon",
    recent_review_days: "",
    recent_review_text: "",
    category: "Cafe",
    price: "$$",
    open_status: "Open",
    list_address: "Session Road",
    full_address: "123 Session Road, Baguio, 2600 Benguet, Philippines",
    located_in: "",
    plus_code: "ABC+123",
    website: "",
    facebook: "https://facebook.com/sunrisecafe",
    instagram: "https://instagram.com/sunrisecafe",
    phone: "+63 912 345 6789",
    hours: "8am-8pm",
    menu_url: "",
    lat: "16.4023",
    lng: "120.5960",
    place_url: "https://maps.google.com/?cid=123",
    place_id: "ChIJabc123",
    tag: "warm-lead",
    search_query: "cafe baguio",
    captured_at: "2026-07-01T00:00:00Z",
    enrich_status: "done",
    enrich_error: "",
  };
  const merged = { ...defaults, ...overrides };
  return headers.map((h) => merged[h] ?? "");
}

function baseRow(overrides: Partial<ScraperRow> = {}): ScraperRow {
  return {
    rowNumber: 1,
    businessName: "Sunrise Cafe",
    category: "Cafe",
    rating: "",
    reviewCount: "",
    recentReview: "",
    recentReviewText: "",
    recentReviewDays: "",
    webPresenceTier: "",
    claimed: "",
    fullAddress: "",
    locatedIn: "",
    website: "",
    facebook: "",
    instagram: "",
    phone: "",
    placeId: "",
    tag: "",
    ...overrides,
  };
}

/**
 * The 31-column headers, i.e. SCRAPER_HEADERS plus the 2026-07-30 additions,
 * inserted in the same position as the real export (right after
 * `recent_review`, before `category`).
 */
const RECENT_REVIEW_IDX = SCRAPER_HEADERS.indexOf("recent_review");
const SCRAPER_HEADERS_V31 = [
  ...SCRAPER_HEADERS.slice(0, RECENT_REVIEW_IDX + 1),
  "recent_review_days",
  "recent_review_text",
  ...SCRAPER_HEADERS.slice(RECENT_REVIEW_IDX + 1),
];

// ---------------------------------------------------------------------------
// parseScraperCsv
// ---------------------------------------------------------------------------

describe("parseScraperCsv — happy path", () => {
  it("parses a realistic full 29-column row", () => {
    const csv = makeScraperCsv(SCRAPER_HEADERS, [fullDataRow()]);
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 1,
      businessName: "Sunrise Cafe",
      category: "Cafe",
      rating: "4.5",
      reviewCount: "1234",
      webPresenceTier: "SOCIAL_ONLY",
      claimed: "unclaimed",
      fullAddress: "123 Session Road, Baguio, 2600 Benguet, Philippines",
      facebook: "https://facebook.com/sunrisecafe",
      instagram: "https://instagram.com/sunrisecafe",
      phone: "+63 912 345 6789",
      placeId: "ChIJabc123",
      tag: "warm-lead",
    });
  });

  it("strips a leading UTF-8 BOM before parsing (regression guard)", () => {
    const csv = "﻿" + makeScraperCsv(SCRAPER_HEADERS, [fullDataRow()]);
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessName).toBe("Sunrise Cafe");
  });

  it("parses CRLF line endings", () => {
    const csv = makeScraperCsv(SCRAPER_HEADERS, [fullDataRow()]).replace(/\n/g, "\r\n");
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessName).toBe("Sunrise Cafe");
  });

  it("matches headers case-insensitively and tolerates surrounding whitespace", () => {
    const paddedHeaders = SCRAPER_HEADERS.map((h) => `  ${h.toUpperCase()}  `);
    const csv = makeScraperCsv(paddedHeaders, [fullDataRow()]);
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].businessName).toBe("Sunrise Cafe");
    expect(rows[0].facebook).toBe("https://facebook.com/sunrisecafe");
  });
});

describe("parseScraperCsv — 31-column export (recent_review_days / recent_review_text)", () => {
  it("parses the two new columns when present", () => {
    const csv = makeScraperCsv(
      SCRAPER_HEADERS_V31,
      [
        fullDataRow(
          {
            name: "Cafe Carolina",
            recent_review: "5 days ago",
            recent_review_days: "5",
            recent_review_text: "Great Beef Tapa, super flavorful.",
          },
          SCRAPER_HEADERS_V31
        ),
      ]
    );
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].recentReviewDays).toBe("5");
    expect(rows[0].recentReviewText).toBe("Great Beef Tapa, super flavorful.");
  });

  it("back-compat: an old 29-column CSV (no new headers) still parses fine, new fields default to empty string", () => {
    const csv = makeScraperCsv(SCRAPER_HEADERS, [
      fullDataRow({ name: "Legacy Cafe", recent_review: "3 weeks ago" }),
    ]);
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessName).toBe("Legacy Cafe");
    expect(rows[0].recentReviewText).toBe("");
    expect(rows[0].recentReviewDays).toBe("");
  });
});

describe("parseScraperCsv — missing name", () => {
  it("reports an error row for missing name, but still parses other rows", () => {
    const csv = makeScraperCsv(SCRAPER_HEADERS, [
      fullDataRow({ name: "" }),
      fullDataRow({ name: "Good Shop" }),
    ]);
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].reason).toMatch(/missing name/i);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[0].businessName).toBe("Good Shop");
  });
});

describe("parseScraperCsv — partial columns", () => {
  it("still parses with only a subset of columns present", () => {
    const csv = makeScraperCsv(
      ["name", "category", "facebook"],
      [["Corner Store", "Retail", "https://facebook.com/cornerstore"]]
    );
    const { rows, errors } = parseScraperCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].businessName).toBe("Corner Store");
    expect(rows[0].category).toBe("Retail");
    expect(rows[0].facebook).toBe("https://facebook.com/cornerstore");
    // Missing/tolerated columns default to ""
    expect(rows[0].rating).toBe("");
    expect(rows[0].phone).toBe("");
    expect(rows[0].placeId).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildScraperKeyPoints
// ---------------------------------------------------------------------------

describe("buildScraperKeyPoints", () => {
  it("produces the expected full joined string for a complete row", () => {
    const row = baseRow({
      category: "Cafe",
      fullAddress: "123 Session Road, Baguio, 2600 Benguet, Philippines",
      rating: "4.5",
      reviewCount: "1234",
      webPresenceTier: "SOCIAL_ONLY",
      claimed: "unclaimed",
      recentReview: "Great coffee and friendly staff",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toBe(
      'Baguio-based Cafe · 4.5★ (1,234 reviews) · social media only (no real website) · ' +
        'unclaimed on Google · recent review: "Great coffee and friendly staff"'
    );
  });

  it("derives locality from fullAddress using the PH postal-code heuristic", () => {
    const row = baseRow({
      category: "Bakery",
      fullAddress: "45 Rizal St, Baguio, 2600 Benguet, Philippines",
    });
    expect(buildScraperKeyPoints(row)).toContain("Baguio-based Bakery");
  });

  it("falls back to the second part when no postal-code part is present", () => {
    const row = baseRow({
      category: "Bakery",
      fullAddress: "Some Street, Manila",
    });
    expect(buildScraperKeyPoints(row)).toContain("Manila-based Bakery");
  });

  it("prefers locatedIn over fullAddress-derived locality", () => {
    const row = baseRow({
      category: "Cafe",
      locatedIn: "SM Baguio",
      fullAddress: "123 Session Road, Baguio, 2600 Benguet, Philippines",
    });
    expect(buildScraperKeyPoints(row)).toContain("Cafe inside SM Baguio");
  });

  it("omits the web-presence segment for UNKNOWN tier", () => {
    const row = baseRow({ category: "Cafe", webPresenceTier: "UNKNOWN" });
    const result = buildScraperKeyPoints(row);
    expect(result).not.toMatch(/website|social/i);
  });

  it("omits the web-presence segment when tier is empty", () => {
    const row = baseRow({ category: "Cafe", webPresenceTier: "" });
    const result = buildScraperKeyPoints(row);
    expect(result).not.toMatch(/website|social/i);
  });

  it("omits the claimed segment when claimed is empty", () => {
    const row = baseRow({ category: "Cafe", claimed: "" });
    const result = buildScraperKeyPoints(row);
    expect(result).not.toMatch(/claimed/i);
  });

  it("uses thousands separators and plural 'reviews' for counts > 1", () => {
    const row = baseRow({ category: "Cafe", rating: "4.8", reviewCount: "12345" });
    expect(buildScraperKeyPoints(row)).toContain("4.8★ (12,345 reviews)");
  });

  it("uses singular 'review' for a review count of exactly 1", () => {
    const row = baseRow({ category: "Cafe", rating: "5", reviewCount: "1" });
    expect(buildScraperKeyPoints(row)).toContain("5★ (1 review)");
  });

  it("omits the count when reviewCount is not a parseable number", () => {
    const row = baseRow({ category: "Cafe", rating: "4.2", reviewCount: "" });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain("4.2★");
    expect(result).not.toContain("(");
  });

  it("truncates a long recentReview on a word boundary with a trailing ellipsis", () => {
    const longReview =
      "This place is absolutely wonderful and I would recommend it to anyone looking for a great meal " +
      "with excellent service and a cozy atmosphere that makes you want to stay for hours on end";
    const row = baseRow({ category: "Cafe", recentReview: longReview });
    const result = buildScraperKeyPoints(row);
    const match = result.match(/recent review: "(.*)"$/);
    expect(match).not.toBeNull();
    const quoted = match![1];
    expect(quoted.length).toBeLessThanOrEqual(141); // 140 + ellipsis char
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted).not.toContain("  ");
  });

  it("collapses whitespace runs in recentReview", () => {
    const row = baseRow({
      category: "Cafe",
      recentReview: "Great   food\n\nand   service",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain('recent review: "Great food and service"');
  });

  it("falls back to businessName when every segment would be empty", () => {
    const row = baseRow({ businessName: "Mystery Shop", category: "" });
    expect(buildScraperKeyPoints(row)).toBe("Mystery Shop");
  });

  // Regression: the scraper's `recent_review` column frequently holds a
  // relative-date timestamp element ("2 years ago"), not review text. Feeding
  // that to the AI verbatim produced a real, damaging cold open ("it looks
  // like your last customer review was posted around two years ago"), so the
  // segment must be omitted entirely rather than quoted as if it were prose.
  describe("omits the recent-review segment for relative-date-only values", () => {
    const relativeDateValues = [
      "a month ago",
      "22 days ago",
      "2 years ago",
      "a day ago",
      "3 days ago",
      "an hour ago",
      "a week ago",
      "1 minute ago",
      "yesterday",
      "today",
      "just now",
      "a moment ago",
      "a while ago",
      "recently",
    ];

    for (const value of relativeDateValues) {
      it(`omits the segment for "${value}"`, () => {
        const row = baseRow({ category: "Cafe", recentReview: value });
        const result = buildScraperKeyPoints(row);
        expect(result).not.toMatch(/recent review/i);
      });
    }

    it("is case-insensitive and tolerant of surrounding/internal whitespace", () => {
      const row = baseRow({ category: "Cafe", recentReview: "  2  YEARS   AGO  " });
      const result = buildScraperKeyPoints(row);
      expect(result).not.toMatch(/recent review/i);
    });

    it("keeps genuine prose that happens to contain a relative date", () => {
      const row = baseRow({
        category: "Cafe",
        recentReview: "Great coffee, visited a month ago",
      });
      const result = buildScraperKeyPoints(row);
      expect(result).toContain('recent review: "Great coffee, visited a month ago"');
    });

    it("still omits the segment when recentReview is empty", () => {
      const row = baseRow({ category: "Cafe", recentReview: "" });
      const result = buildScraperKeyPoints(row);
      expect(result).not.toMatch(/recent review/i);
    });

    it("never returns an empty string when the only populated field is a relative-date recentReview", () => {
      const row = baseRow({ businessName: "Mystery Cafe", category: "", recentReview: "2 years ago" });
      const result = buildScraperKeyPoints(row);
      expect(result).toBe("Mystery Cafe");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// buildScraperKeyPoints — recent_review_text (2026-07-30)
// ---------------------------------------------------------------------------

describe("buildScraperKeyPoints — recentReviewText preference", () => {
  it("uses real review prose from the actual export when recentReviewText is populated, even though recentReview is a relative-date phrase", () => {
    // Row 7 of the real 2026-07-30 export (Quadros Cafe and Resto Bar).
    const row = baseRow({
      businessName: "Quadros Cafe and Resto Bar",
      category: "Coffee shop",
      recentReview: "a year ago",
      recentReviewText:
        "A hidden gem. While I didn't get to try their food, the coffee is acceptable. Nothing special, it was good for its price. …",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain(
      'recent review: "A hidden gem. While I didn\'t get to try their food, the coffee is acceptable. Nothing special, it was good for its price."'
    );
    // The relative-date recentReview must never leak into prose.
    expect(result).not.toMatch(/a year ago/i);
  });

  it("omits the segment entirely when recentReviewText is blank and recentReview is only a relative-date age (real-export shape: 9 of 16 rows have no captured review text)", () => {
    // Row 6 of the real export (ALU Garden Tagaytay): recent_review="a day ago", recent_review_text="".
    const row = baseRow({
      businessName: "ALU Garden Tagaytay",
      category: "Cafe",
      recentReview: "a day ago",
      recentReviewText: "",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).not.toMatch(/recent review/i);
  });

  it("strips a trailing single-character ellipsis (U+2026) left over from Maps' own truncation", () => {
    // Row 14 of the real export (Caja Fika).
    const row = baseRow({
      businessName: "Caja Fika",
      category: "Cafe",
      recentReviewText: "affordable and worth it 💘 …",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain('recent review: "affordable and worth it 💘"');
    expect(result).not.toContain("…");
  });

  it("strips a trailing literal three-dot ellipsis (\"...\") the same way", () => {
    const row = baseRow({
      category: "Cafe",
      recentReviewText: "Worth a stop, cozy vibe...",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain('recent review: "Worth a stop, cozy vibe"');
    expect(result).not.toContain("...");
  });

  it("truncates emoji-containing review text without splitting a surrogate pair (code-point safe)", () => {
    // Construct a string where a naive UTF-16 `.slice(0, 140)` lands exactly
    // inside the emoji's surrogate pair, to prove the fix is real and not
    // coincidentally safe.
    const prefix = "a".repeat(139); // 139 code units, all BMP, no spaces
    const emoji = "\u{1F600}"; // 😀 — astral, encoded as a surrogate pair
    const suffix = "b".repeat(50); // push well past the 140-char limit
    const text = prefix + emoji + suffix;

    // Sanity check: naive slicing really does break this input.
    const naiveSlice = text.slice(0, 140);
    const lastUnit = naiveSlice.charCodeAt(naiveSlice.length - 1);
    expect(lastUnit).toBeGreaterThanOrEqual(0xd800);
    expect(lastUnit).toBeLessThanOrEqual(0xdbff); // lone high surrogate = broken

    const row = baseRow({ category: "Cafe", recentReviewText: text });
    const result = buildScraperKeyPoints(row);

    // No unpaired surrogate (i.e. no split emoji) anywhere in the output.
    const hasLoneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result);
    expect(hasLoneSurrogate).toBe(false);
    expect(result).toContain(emoji);
  });

  it("keeps the existing recentReview fallback (relative-date) behaviour when recentReviewText is absent (back-compat)", () => {
    const row = baseRow({
      category: "Cafe",
      recentReview: "Great coffee, visited a month ago",
      recentReviewText: "",
    });
    const result = buildScraperKeyPoints(row);
    expect(result).toContain('recent review: "Great coffee, visited a month ago"');
  });
});

// ---------------------------------------------------------------------------
// parseRecentReviewDays
// ---------------------------------------------------------------------------

describe("parseRecentReviewDays", () => {
  it('parses "365" to 365', () => {
    expect(parseRecentReviewDays("365")).toBe(365);
  });

  it('parses "0" to 0 — NOT dropped as falsy (a review posted today is meaningful)', () => {
    expect(parseRecentReviewDays("0")).toBe(0);
  });

  it("returns undefined for an empty string", () => {
    expect(parseRecentReviewDays("")).toBeUndefined();
  });

  it("returns undefined for non-numeric junk", () => {
    expect(parseRecentReviewDays("abc")).toBeUndefined();
  });

  it("returns undefined for a negative number", () => {
    expect(parseRecentReviewDays("-5")).toBeUndefined();
  });

  it("returns undefined for NaN/Infinity-producing input", () => {
    expect(parseRecentReviewDays("NaN")).toBeUndefined();
    expect(parseRecentReviewDays("Infinity")).toBeUndefined();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRecentReviewDays("  21  ")).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// deriveChannel
// ---------------------------------------------------------------------------

describe("deriveChannel", () => {
  it("honours defaultChannel when the matching handle exists", () => {
    const row = baseRow({
      facebook: "fb.com/a",
      instagram: "ig.com/a",
      phone: "123",
    });
    expect(deriveChannel(row, "instagram")).toBe("instagram");
  });

  it("falls back to facebook -> instagram -> phone when defaultChannel handle is missing", () => {
    const row = baseRow({ facebook: "", instagram: "ig.com/a", phone: "123" });
    expect(deriveChannel(row, "facebook")).toBe("instagram");
  });

  it("falls back to phone when facebook and instagram are both missing", () => {
    const row = baseRow({ facebook: "", instagram: "", phone: "123" });
    expect(deriveChannel(row)).toBe("phone");
  });

  it("prefers facebook over instagram/phone with no defaultChannel", () => {
    const row = baseRow({ facebook: "fb.com/a", instagram: "ig.com/a", phone: "123" });
    expect(deriveChannel(row)).toBe("facebook");
  });

  it("returns null when the row has no contact vector at all", () => {
    const row = baseRow({ facebook: "", instagram: "", phone: "" });
    expect(deriveChannel(row)).toBeNull();
  });
});

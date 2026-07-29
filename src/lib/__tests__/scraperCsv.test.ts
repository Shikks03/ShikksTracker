/**
 * Unit tests for src/lib/scraperCsv.ts — the "Maps Lead Scraper" CSV parser,
 * deterministic keyPoints builder, and channel derivation.
 *
 * Covers: full 29-column parse, the BOM regression guard, CRLF line endings,
 * header case/whitespace tolerance, missing `name` handling, partial-column
 * CSVs, keyPoints segment composition, and deriveChannel fallback order.
 */

import { describe, it, expect } from "vitest";
import { parseScraperCsv, buildScraperKeyPoints, deriveChannel, ScraperRow } from "@/lib/scraperCsv";

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

/** A full, realistic 29-column data row matching SCRAPER_HEADERS order. */
function fullDataRow(overrides: Record<string, string> = {}): string[] {
  const defaults: Record<string, string> = {
    name: "Sunrise Cafe",
    web_presence_tier: "SOCIAL_ONLY",
    has_website: "no",
    claimed: "unclaimed",
    rating: "4.5",
    review_count: "1234",
    recent_review: "Great coffee and friendly staff, will come back again soon",
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
  return SCRAPER_HEADERS.map((h) => merged[h] ?? "");
}

function baseRow(overrides: Partial<ScraperRow> = {}): ScraperRow {
  return {
    rowNumber: 1,
    businessName: "Sunrise Cafe",
    category: "Cafe",
    rating: "",
    reviewCount: "",
    recentReview: "",
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

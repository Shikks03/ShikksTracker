import Papa from "papaparse";

/**
 * scraperCsv.ts — parser + key-points builder for the "Maps Lead Scraper"
 * Chrome-extension CSV export (29 columns, Philippine businesses scraped
 * from Google Maps). This format has NO email address and NO contact/owner
 * name — leads are contacted via Facebook/Instagram/phone instead, so this
 * module is deliberately separate from csv.ts (the standard-CSV parser),
 * even though it mirrors its header-matching conventions.
 *
 * Pure module: no server/DB imports, safe to unit-test in isolation and to
 * import from client code if ever needed for a preview.
 */

export type OutreachChannel = "email" | "facebook" | "instagram" | "phone";
export type NonEmailChannel = "facebook" | "instagram" | "phone";

export interface ScraperRow {
  /** 1-based row index (header row not counted). */
  rowNumber: number;
  businessName: string; // from `name`
  category: string;
  rating: string;
  reviewCount: string;
  recentReview: string;
  webPresenceTier: string;
  claimed: string;
  fullAddress: string;
  locatedIn: string;
  website: string;
  facebook: string;
  instagram: string;
  phone: string;
  placeId: string;
  tag: string;
}

export interface RowError {
  row: number;
  reason: string;
}

/**
 * Map a raw header string to a normalised key (lowercase, no surrounding
 * spaces) for case-insensitive + whitespace-tolerant header matching.
 * Mirrors csv.ts's normalizeHeader (kept local — see module doc comment).
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

/**
 * Parse the scraper's 29-column CSV export into validated rows and
 * per-row errors.
 *
 * GOTCHA: the scraper writes the file with a UTF-8 BOM (`﻿`) prefix and
 * CRLF line endings. Papaparse does not strip the BOM itself, which would
 * otherwise silently corrupt the first header (`"﻿name"` fails to match
 * `name`) — so we strip a leading BOM before handing the text to Papa.
 *
 * Only `name` is required; every other column is tolerated as missing
 * (returned as `""`) so a scraper CSV with a subset of columns still parses.
 */
export function parseScraperCsv(csvText: string): {
  rows: ScraperRow[];
  errors: RowError[];
} {
  // Strip a leading UTF-8 BOM if present.
  const text = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const rows: ScraperRow[] = [];
  const errors: RowError[] = [];

  const headers = result.meta.fields ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    headerMap[normalizeHeader(h)] = h;
  }

  function getField(row: Record<string, string>, key: string): string {
    const actualHeader = headerMap[normalizeHeader(key)];
    return actualHeader !== undefined ? (row[actualHeader] ?? "").trim() : "";
  }

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i];
    const rowNumber = i + 1; // 1-based, header not counted

    const businessName = getField(row, "name");
    if (!businessName) {
      errors.push({ row: rowNumber, reason: "missing name" });
      continue;
    }

    rows.push({
      rowNumber,
      businessName,
      category: getField(row, "category"),
      rating: getField(row, "rating"),
      reviewCount: getField(row, "review_count"),
      recentReview: getField(row, "recent_review"),
      webPresenceTier: getField(row, "web_presence_tier"),
      claimed: getField(row, "claimed"),
      fullAddress: getField(row, "full_address"),
      locatedIn: getField(row, "located_in"),
      website: getField(row, "website"),
      facebook: getField(row, "facebook"),
      instagram: getField(row, "instagram"),
      phone: getField(row, "phone"),
      placeId: getField(row, "place_id"),
      tag: getField(row, "tag"),
    });
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// buildScraperKeyPoints
// ---------------------------------------------------------------------------

const WEB_PRESENCE_LABELS: Record<string, string> = {
  NO_WEB: "no website or social presence",
  SOCIAL_ONLY: "social media only (no real website)",
  HAS_SITE: "has a website",
};

const CLAIMED_LABELS: Record<string, string> = {
  unclaimed: "unclaimed on Google",
  claimed: "claimed on Google",
};

const RECENT_REVIEW_MAX_LEN = 140;

/**
 * Derive a locality string from a full address, using the documented
 * heuristic:
 *   - split on "," and trim each part
 *   - drop trailing parts equal to "philippines" (case-insensitive)
 *   - find the part immediately BEFORE the first part starting with a
 *     4-digit PH postal code (`/^\d{4}\b/`)
 *   - if no postal-code part exists, use the second part (index 1)
 *   - if only one part remains, there is no derivable locality
 */
function deriveLocalityFromAddress(fullAddress: string): string | null {
  let parts = fullAddress
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  while (parts.length > 0 && /^philippines$/i.test(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
  }

  if (parts.length <= 1) {
    return null;
  }

  const postalIndex = parts.findIndex((p) => /^\d{4}\b/.test(p));
  if (postalIndex > 0) {
    return parts[postalIndex - 1];
  }

  return parts[1];
}

/** Collapse whitespace runs to single spaces and trim. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncate to at most `maxLen` chars on a word boundary, appending "…" if cut. */
function truncateOnWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

/**
 * Build a deterministic, AI-free `keyPoints` string for a scraped lead.
 * This is load-bearing: the AI drafter reads it verbatim to personalise the
 * outreach message, so segments are written as natural prose fragments,
 * joined with " · ". Falls back to the business name if every segment would
 * otherwise be empty (the Contact schema requires non-empty `keyPoints`).
 */
export function buildScraperKeyPoints(row: ScraperRow): string {
  const segments: string[] = [];

  // 1. Locality + category
  const category = row.category || "";
  if (row.locatedIn) {
    segments.push(`${category || "business"} inside ${row.locatedIn}`);
  } else if (row.fullAddress) {
    const locality = deriveLocalityFromAddress(row.fullAddress);
    if (locality) {
      segments.push(`${locality}-based ${category || "business"}`);
    } else if (category) {
      segments.push(category);
    }
  } else if (category) {
    segments.push(category);
  }

  // 2. Rating (+ review count)
  if (row.rating) {
    const n = Number(row.reviewCount);
    if (row.reviewCount && !Number.isNaN(n)) {
      const formatted = n.toLocaleString("en-US");
      const noun = n === 1 ? "review" : "reviews";
      segments.push(`${row.rating}★ (${formatted} ${noun})`);
    } else {
      segments.push(`${row.rating}★`);
    }
  }

  // 3. Web presence
  const webPresence = WEB_PRESENCE_LABELS[row.webPresenceTier];
  if (webPresence) {
    segments.push(webPresence);
  }

  // 4. Claimed
  const claimed = CLAIMED_LABELS[row.claimed];
  if (claimed) {
    segments.push(claimed);
  }

  // 5. Recent review
  if (row.recentReview) {
    const collapsed = collapseWhitespace(row.recentReview);
    const truncated = truncateOnWordBoundary(collapsed, RECENT_REVIEW_MAX_LEN);
    segments.push(`recent review: "${truncated}"`);
  }

  if (segments.length === 0) {
    return row.businessName;
  }

  return segments.join(" · ");
}

// ---------------------------------------------------------------------------
// deriveChannel
// ---------------------------------------------------------------------------

/**
 * Decide which non-email outreach channel a scraped contact should use.
 *  - Honours `defaultChannel` when the row actually has that handle.
 *  - Otherwise falls back to the first available of facebook → instagram → phone.
 *  - Returns null when the row has no contact vector at all.
 */
export function deriveChannel(
  row: ScraperRow,
  defaultChannel?: NonEmailChannel
): NonEmailChannel | null {
  const handles: Record<NonEmailChannel, string> = {
    facebook: row.facebook,
    instagram: row.instagram,
    phone: row.phone,
  };

  if (defaultChannel && handles[defaultChannel]) {
    return defaultChannel;
  }

  if (handles.facebook) return "facebook";
  if (handles.instagram) return "instagram";
  if (handles.phone) return "phone";
  return null;
}

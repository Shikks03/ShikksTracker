import Papa from "papaparse";

export interface ParsedRow {
  /** 1-based row index (header row not counted). */
  rowNumber: number;
  businessName: string;
  contactEmail: string;
  contactName?: string;
  keyPoints: string;
  leadSource: "cold_email" | "referral" | "event_connection" | "other";
}

export interface RowError {
  row: number;
  reason: string;
}

const VALID_LEAD_SOURCES = [
  "cold_email",
  "referral",
  "event_connection",
  "other",
] as const;
type LeadSource = (typeof VALID_LEAD_SOURCES)[number];

/**
 * Map a raw header string to a normalised key (lowercase, no surrounding spaces).
 * This allows case-insensitive + whitespace-tolerant header matching.
 */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

/**
 * Parse a CSV text string into validated rows and per-row errors.
 *
 * - Uses papaparse with `header: true`; surrounding spaces on headers are trimmed.
 * - Column matching is case-insensitive.
 * - Required columns: businessName, contactEmail, keyPoints.
 * - Optional columns: contactName, leadSource (defaults to "cold_email").
 * - Only required-field presence is checked here; email format validation is
 *   intentionally deferred to `createContactChecked` to keep validation in one place.
 */
export function parseContactsCsv(csvText: string): {
  rows: ParsedRow[];
  errors: RowError[];
} {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    // Trim surrounding whitespace from each header so "  contactEmail  " works.
    transformHeader: (header) => header.trim(),
  });

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  // Build a normalised-key → actual-header lookup so field access is
  // case-insensitive even after papaparse has stored the (trimmed) originals.
  const headers = result.meta.fields ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of headers) {
    headerMap[normalizeHeader(h)] = h;
  }

  /**
   * Retrieve a field value using case-insensitive header matching.
   * Returns the trimmed value, or "" if the column is absent.
   */
  function getField(row: Record<string, string>, key: string): string {
    const actualHeader = headerMap[normalizeHeader(key)];
    return actualHeader !== undefined ? (row[actualHeader] ?? "").trim() : "";
  }

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i];
    const rowNumber = i + 1; // 1-based, header not counted

    const businessName = getField(row, "businessName");
    const contactEmail = getField(row, "contactEmail");
    const keyPoints = getField(row, "keyPoints");
    const contactName = getField(row, "contactName") || undefined;
    const leadSourceRaw = getField(row, "leadSource");

    // --- Required field presence checks ---
    if (!businessName) {
      errors.push({ row: rowNumber, reason: "missing businessName" });
      continue;
    }
    if (!contactEmail) {
      errors.push({ row: rowNumber, reason: "missing contactEmail" });
      continue;
    }
    if (!keyPoints) {
      errors.push({ row: rowNumber, reason: "missing keyPoints" });
      continue;
    }

    // --- leadSource: default "cold_email", error on unrecognised value ---
    let leadSource: LeadSource = "cold_email";
    if (leadSourceRaw) {
      if (!(VALID_LEAD_SOURCES as readonly string[]).includes(leadSourceRaw)) {
        errors.push({
          row: rowNumber,
          reason: `invalid leadSource "${leadSourceRaw}"; allowed values: ${VALID_LEAD_SOURCES.join(", ")}`,
        });
        continue;
      }
      leadSource = leadSourceRaw as LeadSource;
    }

    rows.push({
      rowNumber,
      businessName,
      contactEmail,
      contactName,
      keyPoints,
      leadSource,
    });
  }

  return { rows, errors };
}

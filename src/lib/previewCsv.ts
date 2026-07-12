/**
 * previewCsv.ts — Client-safe CSV dry-run preview.
 *
 * Mirrors the server-side validation pipeline (csv.ts → createContactChecked)
 * so the preview's valid/invalid counts match the eventual import result,
 * minus suppression and duplicate checks (those require DB access).
 *
 * Safe to import in "use client" components — no server-only dependencies.
 */

import { parseContactsCsv, ParsedRow, RowError } from "@/lib/csv";
import { isValidEmail } from "@/lib/email";

export interface PreviewValidRow {
  rowNumber: number;
  businessName: string;
  contactEmail: string;
  leadSource: string;
}

export interface PreviewInvalidRow {
  rowNumber: number;
  reason: string;
}

export interface CsvPreviewResult {
  totalRows: number;
  validRows: PreviewValidRow[];
  invalidRows: PreviewInvalidRow[];
}

/**
 * Parse a CSV text string client-side and classify rows as valid or invalid.
 *
 * Validation steps applied (matching server behaviour):
 *  1. papaparse parse with case-insensitive, whitespace-tolerant header matching
 *  2. Required fields: businessName, contactEmail, keyPoints (csv.ts)
 *  3. leadSource value must be a recognised enum value if provided (csv.ts)
 *  4. Email format: isValidEmail (contacts.ts / createContactChecked step 1)
 *
 * NOT checked here (require DB — checked server-side at import time):
 *  - Suppression list membership
 *  - Duplicate contacts (within-CSV and in the DB)
 */
export function previewCsv(csvText: string): CsvPreviewResult {
  const { rows, errors } = parseContactsCsv(csvText);

  const validRows: PreviewValidRow[] = [];
  const invalidRows: PreviewInvalidRow[] = errors.map((e: RowError) => ({
    rowNumber: e.row,
    reason: e.reason,
  }));

  for (const row of rows as ParsedRow[]) {
    if (!isValidEmail(row.contactEmail)) {
      invalidRows.push({
        rowNumber: row.rowNumber,
        reason: `invalid email format: ${row.contactEmail}`,
      });
    } else {
      validRows.push({
        rowNumber: row.rowNumber,
        businessName: row.businessName,
        contactEmail: row.contactEmail,
        leadSource: row.leadSource,
      });
    }
  }

  // Sort invalid rows by row number for consistent display
  invalidRows.sort((a, b) => a.rowNumber - b.rowNumber);

  const totalRows = validRows.length + invalidRows.length;
  return { totalRows, validRows, invalidRows };
}

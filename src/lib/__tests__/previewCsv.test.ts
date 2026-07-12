/**
 * Unit tests for previewCsv (src/lib/previewCsv.ts).
 *
 * Covers: valid rows pass, missing required fields produce reasons,
 * invalid email caught by isValidEmail, leadSource defaulting, header
 * case-insensitivity, and scope clarification (suppression/dup not checked).
 */

import { describe, it, expect } from "vitest";
import { previewCsv } from "@/lib/previewCsv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCsv(headers: string[], ...dataRows: string[][]): string {
  return [headers.join(","), ...dataRows.map((r) => r.join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// Happy path — valid rows
// ---------------------------------------------------------------------------

describe("previewCsv — valid rows", () => {
  it("classifies a complete valid row as valid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Acme Corp", "acme@example.com", "Great bakery", "referral"]
    );
    const { totalRows, validRows, invalidRows } = previewCsv(csv);
    expect(totalRows).toBe(1);
    expect(invalidRows).toHaveLength(0);
    expect(validRows).toHaveLength(1);
    expect(validRows[0]).toMatchObject({
      rowNumber: 1,
      businessName: "Acme Corp",
      contactEmail: "acme@example.com",
      leadSource: "referral",
    });
  });

  it("defaults leadSource to 'cold_email' when absent", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Buko Shop", "buko@example.com", "Laguna specialty"]
    );
    const { validRows } = previewCsv(csv);
    expect(validRows[0].leadSource).toBe("cold_email");
  });

  it("defaults leadSource to 'cold_email' when column is empty", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Shop", "shop@example.com", "Notes", ""]
    );
    const { validRows } = previewCsv(csv);
    expect(validRows[0].leadSource).toBe("cold_email");
  });

  it("returns totalRows = validRows + invalidRows", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      "Good Shop,good@x.com,Notes",   // valid
      ",bad@x.com,Notes",              // missing businessName → invalid
      "Other,other@x.com,Notes",       // valid
    ].join("\n");
    const { totalRows, validRows, invalidRows } = previewCsv(csv);
    expect(totalRows).toBe(validRows.length + invalidRows.length);
    expect(totalRows).toBe(3);
    expect(validRows).toHaveLength(2);
    expect(invalidRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Invalid rows — structural / field errors (from csv.ts)
// ---------------------------------------------------------------------------

describe("previewCsv — missing required fields", () => {
  it("classifies missing businessName as invalid with matching reason", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["", "a@x.com", "Notes"]
    );
    const { validRows, invalidRows } = previewCsv(csv);
    expect(validRows).toHaveLength(0);
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].rowNumber).toBe(1);
    expect(invalidRows[0].reason).toMatch(/missing businessName/i);
  });

  it("classifies missing contactEmail as invalid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Acme", "", "Notes"]
    );
    const { invalidRows } = previewCsv(csv);
    expect(invalidRows[0].reason).toMatch(/missing contactEmail/i);
  });

  it("classifies missing keyPoints as invalid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Acme", "a@x.com", ""]
    );
    const { invalidRows } = previewCsv(csv);
    expect(invalidRows[0].reason).toMatch(/missing keyPoints/i);
  });

  it("classifies an unrecognised leadSource as invalid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Acme", "a@x.com", "Notes", "facebook"]
    );
    const { validRows, invalidRows } = previewCsv(csv);
    expect(validRows).toHaveLength(0);
    expect(invalidRows[0].reason).toMatch(/invalid leadSource/i);
    expect(invalidRows[0].reason).toContain("facebook");
  });
});

// ---------------------------------------------------------------------------
// Invalid rows — email format (isValidEmail step, not a csv.ts check)
// ---------------------------------------------------------------------------

describe("previewCsv — email format validation", () => {
  it("classifies a malformed email as invalid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Acme Corp", "not-an-email", "Notes"]
    );
    const { validRows, invalidRows } = previewCsv(csv);
    expect(validRows).toHaveLength(0);
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].reason).toMatch(/invalid email format/i);
    expect(invalidRows[0].reason).toContain("not-an-email");
  });

  it("classifies email with no TLD as invalid", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Corp", "user@nodomain", "Notes"]
    );
    const { invalidRows } = previewCsv(csv);
    expect(invalidRows).toHaveLength(1);
    expect(invalidRows[0].reason).toMatch(/invalid email format/i);
  });

  it("accepts a structurally valid email", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Corp", "user@domain.ph", "Notes"]
    );
    const { validRows, invalidRows } = previewCsv(csv);
    expect(invalidRows).toHaveLength(0);
    expect(validRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Header case-insensitivity (inherited from csv.ts)
// ---------------------------------------------------------------------------

describe("previewCsv — header case-insensitivity", () => {
  it("accepts BUSINESSNAME / CONTACTEMAIL / KEYPOINTS headers", () => {
    const csv = makeCsv(
      ["BUSINESSNAME", "CONTACTEMAIL", "KEYPOINTS"],
      ["Bakery", "b@x.com", "Fresh bread"]
    );
    const { validRows, invalidRows } = previewCsv(csv);
    expect(invalidRows).toHaveLength(0);
    expect(validRows[0].businessName).toBe("Bakery");
    expect(validRows[0].contactEmail).toBe("b@x.com");
  });

  it("accepts mixed-case headers", () => {
    const csv = makeCsv(
      ["BusinessName", "ContactEmail", "KeyPoints"],
      ["Shop", "s@x.com", "Notes"]
    );
    const { validRows } = previewCsv(csv);
    expect(validRows[0].businessName).toBe("Shop");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("previewCsv — edge cases", () => {
  it("returns zero rows for header-only CSV", () => {
    const csv = "businessName,contactEmail,keyPoints";
    const { totalRows, validRows, invalidRows } = previewCsv(csv);
    expect(totalRows).toBe(0);
    expect(validRows).toHaveLength(0);
    expect(invalidRows).toHaveLength(0);
  });

  it("skips empty lines between rows", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      "Shop A,a@x.com,Notes A",
      "",
      "Shop B,b@x.com,Notes B",
    ].join("\n");
    const { totalRows, validRows } = previewCsv(csv);
    expect(totalRows).toBe(2);
    expect(validRows).toHaveLength(2);
  });

  it("sorts invalid rows by row number", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      ",b@x.com,Notes",           // row 1 invalid
      "Good,good@x.com,Notes",    // row 2 valid
      "Bad,,Notes",               // row 3 invalid
    ].join("\n");
    const { invalidRows } = previewCsv(csv);
    expect(invalidRows[0].rowNumber).toBeLessThan(invalidRows[1].rowNumber);
  });
});

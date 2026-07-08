/**
 * Unit tests for parseContactsCsv in src/lib/csv.ts.
 *
 * Covers: header case-insensitivity, missing required fields, bad leadSource,
 * optional fields, default leadSource, and row numbering.
 */

import { describe, it, expect } from "vitest";
import { parseContactsCsv } from "@/lib/csv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid CSV string with the given headers and one data row. */
function makeCsv(headers: string[], row: string[]): string {
  return [headers.join(","), row.join(",")].join("\n");
}

// ---------------------------------------------------------------------------
// Happy path — all required fields present
// ---------------------------------------------------------------------------

describe("parseContactsCsv — happy path", () => {
  it("parses a valid row with all fields", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "contactName", "leadSource"],
      ["Acme Corp", "acme@example.com", "Great bakery", "Juan", "referral"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowNumber: 1,
      businessName: "Acme Corp",
      contactEmail: "acme@example.com",
      keyPoints: "Great bakery",
      contactName: "Juan",
      leadSource: "referral",
    });
  });

  it("defaults leadSource to 'cold_email' when column is absent", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Buko Pie Shop", "buko@example.com", "Laguna specialty"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].leadSource).toBe("cold_email");
  });

  it("defaults leadSource to 'cold_email' when column is present but empty", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Shop", "shop@example.com", "Nice place", ""]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].leadSource).toBe("cold_email");
  });

  it("omits contactName from row when column is absent", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Shop", "shop@example.com", "Friendly staff"]
    );
    const { rows } = parseContactsCsv(csv);
    expect(rows[0].contactName).toBeUndefined();
  });

  it("omits contactName when column is present but empty", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "contactName"],
      ["Shop", "shop@example.com", "Friendly staff", ""]
    );
    const { rows } = parseContactsCsv(csv);
    expect(rows[0].contactName).toBeUndefined();
  });

  it("parses all four valid leadSource values", () => {
    const validSources = ["cold_email", "referral", "event_connection", "other"] as const;
    for (const source of validSources) {
      const csv = makeCsv(
        ["businessName", "contactEmail", "keyPoints", "leadSource"],
        ["Shop", "s@example.com", "Notes", source]
      );
      const { rows, errors } = parseContactsCsv(csv);
      expect(errors).toHaveLength(0);
      expect(rows[0].leadSource).toBe(source);
    }
  });

  it("assigns 1-based rowNumber to each row (header not counted)", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      "Shop A,a@x.com,Notes A",
      "Shop B,b@x.com,Notes B",
      "Shop C,c@x.com,Notes C",
    ].join("\n");
    const { rows } = parseContactsCsv(csv);
    expect(rows[0].rowNumber).toBe(1);
    expect(rows[1].rowNumber).toBe(2);
    expect(rows[2].rowNumber).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Header case-insensitivity
// ---------------------------------------------------------------------------

describe("parseContactsCsv — header case-insensitivity", () => {
  it("accepts BUSINESSNAME (all-caps header)", () => {
    const csv = makeCsv(
      ["BUSINESSNAME", "CONTACTEMAIL", "KEYPOINTS"],
      ["Acme", "a@x.com", "Notes"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].businessName).toBe("Acme");
  });

  it("accepts mixed-case headers (BusinessName, ContactEmail, KeyPoints)", () => {
    const csv = makeCsv(
      ["BusinessName", "ContactEmail", "KeyPoints"],
      ["Bakery", "b@x.com", "Fresh bread"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].businessName).toBe("Bakery");
    expect(rows[0].contactEmail).toBe("b@x.com");
    expect(rows[0].keyPoints).toBe("Fresh bread");
  });

  it("accepts contactname (all-lowercase header)", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "contactname"],
      ["Shop", "s@x.com", "Notes", "Maria"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].contactName).toBe("Maria");
  });

  it("accepts LEADSOURCE (all-caps)", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "LEADSOURCE"],
      ["Corp", "c@x.com", "Notes", "other"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].leadSource).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// Missing required fields — errors
// ---------------------------------------------------------------------------

describe("parseContactsCsv — missing required fields", () => {
  it("reports error for missing businessName", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["", "a@x.com", "Notes"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(errors[0].reason).toMatch(/missing businessName/i);
  });

  it("reports error for missing contactEmail", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Acme", "", "Notes"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/missing contactEmail/i);
  });

  it("reports error for missing keyPoints", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["Acme", "a@x.com", ""]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/missing keyPoints/i);
  });

  it("continues processing other rows when one row has an error", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      ",missing@x.com,Notes",       // row 1: missing businessName
      "GoodShop,good@x.com,Notes",  // row 2: valid
    ].join("\n");
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Invalid leadSource
// ---------------------------------------------------------------------------

describe("parseContactsCsv — invalid leadSource", () => {
  it("reports error for an unrecognised leadSource value", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Acme", "a@x.com", "Notes", "facebook"]
    );
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toMatch(/invalid leadSource/i);
    expect(errors[0].reason).toContain("facebook");
  });

  it("error message lists allowed values", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints", "leadSource"],
      ["Acme", "a@x.com", "Notes", "twitter"]
    );
    const { errors } = parseContactsCsv(csv);
    expect(errors[0].reason).toContain("cold_email");
    expect(errors[0].reason).toContain("referral");
    expect(errors[0].reason).toContain("event_connection");
    expect(errors[0].reason).toContain("other");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("parseContactsCsv — edge cases", () => {
  it("returns empty rows and errors for empty CSV (header only)", () => {
    const csv = "businessName,contactEmail,keyPoints";
    const { rows, errors } = parseContactsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("skips empty lines between rows", () => {
    const csv = [
      "businessName,contactEmail,keyPoints",
      "Shop A,a@x.com,Notes",
      "",
      "Shop B,b@x.com,Notes B",
    ].join("\n");
    const { rows, errors } = parseContactsCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
  });

  it("trims surrounding whitespace from field values", () => {
    const csv = makeCsv(
      ["businessName", "contactEmail", "keyPoints"],
      ["  Bakery  ", "  b@x.com  ", "  Good notes  "]
    );
    const { rows } = parseContactsCsv(csv);
    expect(rows[0].businessName).toBe("Bakery");
    expect(rows[0].contactEmail).toBe("b@x.com");
    expect(rows[0].keyPoints).toBe("Good notes");
  });
});

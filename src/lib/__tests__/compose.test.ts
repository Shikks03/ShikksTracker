/**
 * Unit tests for applyPlaceholders in src/lib/compose.ts.
 *
 * Covers: case variants, whitespace inside braces, contactName fallback,
 * unknown token passthrough, and combined usage.
 */

import { describe, it, expect } from "vitest";
import { applyPlaceholders } from "@/lib/compose";

describe("applyPlaceholders", () => {
  // ---------------------------------------------------------------------------
  // Basic substitution
  // ---------------------------------------------------------------------------

  it("replaces {{businessName}} with the contact businessName", () => {
    const result = applyPlaceholders(
      "Hello {{businessName}}, welcome!",
      { businessName: "Acme Corp", contactName: "Juan" }
    );
    expect(result).toBe("Hello Acme Corp, welcome!");
  });

  it("replaces {{contactName}} with the contact contactName", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}, how are you?",
      { businessName: "Acme Corp", contactName: "Juan" }
    );
    expect(result).toBe("Hi Juan, how are you?");
  });

  // ---------------------------------------------------------------------------
  // Case insensitivity
  // ---------------------------------------------------------------------------

  it("replaces {{BUSINESSNAME}} (all-caps token)", () => {
    const result = applyPlaceholders(
      "Dear {{BUSINESSNAME}}",
      { businessName: "Acme Corp" }
    );
    expect(result).toBe("Dear Acme Corp");
  });

  it("replaces {{ContactName}} (mixed-case token)", () => {
    const result = applyPlaceholders(
      "Hi {{ContactName}}",
      { businessName: "Acme Corp", contactName: "Maria" }
    );
    expect(result).toBe("Hi Maria");
  });

  it("replaces {{contactname}} (all-lowercase token)", () => {
    const result = applyPlaceholders(
      "Hi {{contactname}}",
      { businessName: "Acme Corp", contactName: "Pedro" }
    );
    expect(result).toBe("Hi Pedro");
  });

  it("replaces {{CONTACTNAME}} (all-caps)", () => {
    const result = applyPlaceholders(
      "Hey {{CONTACTNAME}}",
      { businessName: "Acme Corp", contactName: "Ana" }
    );
    expect(result).toBe("Hey Ana");
  });

  // ---------------------------------------------------------------------------
  // Whitespace inside braces
  // ---------------------------------------------------------------------------

  it("replaces {{ businessName }} with surrounding whitespace inside braces", () => {
    const result = applyPlaceholders(
      "Hello {{ businessName }}, hope you are well.",
      { businessName: "MegaCorp" }
    );
    expect(result).toBe("Hello MegaCorp, hope you are well.");
  });

  it("replaces {{  contactName  }} with extra whitespace inside braces", () => {
    const result = applyPlaceholders(
      "Hi {{  contactName  }}",
      { businessName: "MegaCorp", contactName: "Lisa" }
    );
    expect(result).toBe("Hi Lisa");
  });

  // ---------------------------------------------------------------------------
  // contactName fallback to "there"
  // ---------------------------------------------------------------------------

  it("falls back to 'there' when contactName is not provided (undefined)", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}",
      { businessName: "Acme Corp" }
    );
    expect(result).toBe("Hi there");
  });

  it("falls back to 'there' when contactName is null", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}",
      { businessName: "Acme Corp", contactName: null }
    );
    expect(result).toBe("Hi there");
  });

  it("falls back to 'there' when contactName is an empty string", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}",
      { businessName: "Acme Corp", contactName: "" }
    );
    expect(result).toBe("Hi there");
  });

  it("falls back to 'there' when contactName is whitespace only", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}",
      { businessName: "Acme Corp", contactName: "   " }
    );
    expect(result).toBe("Hi there");
  });

  it("trims whitespace from contactName before using it", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}}",
      { businessName: "Acme Corp", contactName: "  Rosa  " }
    );
    expect(result).toBe("Hi Rosa");
  });

  // ---------------------------------------------------------------------------
  // Unknown tokens left untouched
  // ---------------------------------------------------------------------------

  it("leaves unknown {{tokens}} untouched", () => {
    const result = applyPlaceholders(
      "Subject: {{unknownToken}} for {{businessName}}",
      { businessName: "Acme Corp" }
    );
    expect(result).toBe("Subject: {{unknownToken}} for Acme Corp");
  });

  it("leaves {{campaignName}} (unsupported token) untouched", () => {
    const result = applyPlaceholders(
      "See {{campaignName}} for details",
      { businessName: "Acme Corp" }
    );
    expect(result).toBe("See {{campaignName}} for details");
  });

  // ---------------------------------------------------------------------------
  // Multiple replacements in one string
  // ---------------------------------------------------------------------------

  it("replaces multiple tokens in the same string", () => {
    const result = applyPlaceholders(
      "Hi {{contactName}} from {{businessName}}, reach out to {{CONTACTNAME}} again.",
      { businessName: "Sunrise Bakery", contactName: "Luz" }
    );
    expect(result).toBe(
      "Hi Luz from Sunrise Bakery, reach out to Luz again."
    );
  });

  // ---------------------------------------------------------------------------
  // No tokens → passthrough
  // ---------------------------------------------------------------------------

  it("returns the original text unchanged when there are no tokens", () => {
    const text = "This email has no placeholders at all.";
    const result = applyPlaceholders(text, { businessName: "Acme Corp" });
    expect(result).toBe(text);
  });

  // ---------------------------------------------------------------------------
  // Subject line usage
  // ---------------------------------------------------------------------------

  it("works on subject lines (no body-only constraint)", () => {
    const result = applyPlaceholders(
      "Quick question for {{businessName}}",
      { businessName: "Corner Store PH" }
    );
    expect(result).toBe("Quick question for Corner Store PH");
  });
});

/**
 * Unit tests for validateTemplateBody in src/lib/templates.ts.
 *
 * Covers: valid input, each required field empty/whitespace, non-string types,
 * and that trimming is applied to the returned fields.
 * No DB calls — pure function only.
 */

import { describe, it, expect } from "vitest";
import { validateTemplateBody } from "@/lib/templates";

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("validateTemplateBody — valid input", () => {
  it("accepts all three non-empty fields and returns ok:true with trimmed fields", () => {
    const result = validateTemplateBody({
      name:    "  Intro Touch  ",
      subject: "  Quick question for {{businessName}}  ",
      body:    "  Hi {{contactName}}, I wanted to reach out…  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.name).toBe("Intro Touch");
    expect(result.fields.subject).toBe("Quick question for {{businessName}}");
    expect(result.fields.body).toBe("Hi {{contactName}}, I wanted to reach out…");
  });

  it("preserves placeholder tokens in subject and body unchanged", () => {
    const result = validateTemplateBody({
      name:    "Token test",
      subject: "Hello {{businessName}}",
      body:    "Hi {{contactName}}, this is about {{businessName}}.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fields.subject).toBe("Hello {{businessName}}");
    expect(result.fields.body).toBe("Hi {{contactName}}, this is about {{businessName}}.");
  });
});

// ---------------------------------------------------------------------------
// name validation failures
// ---------------------------------------------------------------------------

describe("validateTemplateBody — name failures", () => {
  it("returns ok:false when name is missing", () => {
    const result = validateTemplateBody({ subject: "Subj", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("returns ok:false when name is empty string", () => {
    const result = validateTemplateBody({ name: "", subject: "Subj", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("returns ok:false when name is whitespace only", () => {
    const result = validateTemplateBody({ name: "   ", subject: "Subj", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("returns ok:false when name is a number", () => {
    const result = validateTemplateBody({ name: 42, subject: "Subj", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("returns ok:false when name is null", () => {
    const result = validateTemplateBody({ name: null, subject: "Subj", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });
});

// ---------------------------------------------------------------------------
// subject validation failures
// ---------------------------------------------------------------------------

describe("validateTemplateBody — subject failures", () => {
  it("returns ok:false when subject is missing", () => {
    const result = validateTemplateBody({ name: "Tpl", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/subject/i);
  });

  it("returns ok:false when subject is empty string", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/subject/i);
  });

  it("returns ok:false when subject is whitespace only", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "   ", body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/subject/i);
  });

  it("returns ok:false when subject is a boolean", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: true, body: "Body" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/subject/i);
  });
});

// ---------------------------------------------------------------------------
// body validation failures
// ---------------------------------------------------------------------------

describe("validateTemplateBody — body failures", () => {
  it("returns ok:false when body is missing", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "Subj" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/body/i);
  });

  it("returns ok:false when body is empty string", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "Subj", body: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/body/i);
  });

  it("returns ok:false when body is whitespace only", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "Subj", body: "\n\t  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/body/i);
  });

  it("returns ok:false when body is an array", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "Subj", body: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/body/i);
  });
});

// ---------------------------------------------------------------------------
// Field priority — first failing field wins
// ---------------------------------------------------------------------------

describe("validateTemplateBody — field priority", () => {
  it("reports name error first when multiple fields are invalid", () => {
    const result = validateTemplateBody({ name: "", subject: "", body: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("reports subject error when only name is valid and rest are empty", () => {
    const result = validateTemplateBody({ name: "Tpl", subject: "", body: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/subject/i);
  });
});

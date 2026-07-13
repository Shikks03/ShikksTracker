/**
 * Unit tests for the template-generation helpers in src/lib/draft.ts.
 *
 * Covers the pure buildTemplateUserMessage helper and the intent of
 * TEMPLATE_SYSTEM_PROMPT (placeholders PRESERVED — the opposite of the
 * per-contact prompt). Does NOT call the Anthropic API.
 */

import { describe, it, expect } from "vitest";
import {
  buildTemplateUserMessage,
  TEMPLATE_SYSTEM_PROMPT,
} from "@/lib/draft";
import type { TemplateDraftInput } from "@/lib/draft";

const BASE: TemplateDraftInput = {
  brief: "Friendly stage-1 intro for a bookkeeping service; mention a free consult",
  tone: "Warm, casual, Taglish-friendly",
};

describe("buildTemplateUserMessage", () => {
  it("includes the brief", () => {
    const msg = buildTemplateUserMessage(BASE);
    expect(msg).toContain(
      "Brief: Friendly stage-1 intro for a bookkeeping service; mention a free consult"
    );
  });

  it("includes the tone notes", () => {
    const msg = buildTemplateUserMessage(BASE);
    expect(msg).toContain("Tone notes: Warm, casual, Taglish-friendly");
  });

  it("falls back to a default tone note when tone is empty", () => {
    const msg = buildTemplateUserMessage({ ...BASE, tone: "" });
    expect(msg).toContain("(none — default to professional and warm)");
  });

  it("falls back to a default tone note when tone is undefined", () => {
    const msg = buildTemplateUserMessage({ brief: BASE.brief });
    expect(msg).toContain("(none — default to professional and warm)");
  });

  it("is a pure function (same output for same input)", () => {
    expect(buildTemplateUserMessage(BASE)).toBe(buildTemplateUserMessage(BASE));
  });
});

describe("TEMPLATE_SYSTEM_PROMPT — placeholder intent", () => {
  it("instructs the model to KEEP the {{businessName}} token", () => {
    expect(TEMPLATE_SYSTEM_PROMPT).toContain("{{businessName}}");
  });

  it("instructs the model to KEEP the {{contactName}} token", () => {
    expect(TEMPLATE_SYSTEM_PROMPT).toContain("{{contactName}}");
  });

  it("does NOT forbid placeholders (contrast with the per-contact prompt)", () => {
    expect(TEMPLATE_SYSTEM_PROMPT).not.toMatch(/no placeholders/i);
  });
});

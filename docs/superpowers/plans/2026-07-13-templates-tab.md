# Templates Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Templates" tab (7th sidebar item) with full template CRUD plus an "AI-generate a template" button that drafts reusable subject/body boilerplate from a brief + tone.

**Architecture:** Reuse the existing `Template` model + `validateTemplateBody` helper; add the missing PATCH edit route and a no-save AI-generate route. AI generation is a NEW pure prompt builder + generator in `draft.ts` (kept fully separate from the production `generateEmailDraft` so the send path is never touched). The page follows the Editorial Terminal convention (inline hex + `ui.tsx`/`tokens.ts` primitives), mirroring the existing Campaigns page (left = list, right = editor panel).

**Tech Stack:** Next.js 16 App Router (TypeScript), Mongoose, `@anthropic-ai/sdk` (forced tool use), vitest for the pure-lib layer. UI = inline style objects + Tailwind utility classes via `ui.tsx`.

**Testing convention (read before starting):** This repo unit-tests only the *pure lib layer* (`src/lib/__tests__/`, vitest). Routes and pages are NOT unit-tested here — they are verified with `npx tsc --noEmit` + `npm run build`. So Tasks 3 uses TDD; Tasks 1, 2, 4, 5, 6 are implement-then-typecheck/build.

**Placeholder note (important):** AI-generated *templates* MUST keep `{{businessName}}` / `{{contactName}}` tokens — the opposite of the per-contact `generateEmailDraft` prompt, which forbids placeholders because it fills real names. The template system prompt is an intentional **first-pass** the user will hand-tune later; keep it an isolated, well-commented constant.

---

## Task 1: Enable `updatedAt` on the Template model

**Files:**
- Modify: `src/models/Template.ts:16`

- [ ] **Step 1: Enable the `updatedAt` timestamp**

Editing now exists, so the model should track updates. Change the timestamps option.

In `src/models/Template.ts`, replace:

```ts
  { timestamps: { createdAt: true, updatedAt: false } }
```

with:

```ts
  { timestamps: { createdAt: true, updatedAt: true } }
```

Also update the interface to include the new field. Replace:

```ts
export interface ITemplate extends Document {
  name: string;
  subject: string;
  body: string;
  createdAt: Date;
}
```

with:

```ts
export interface ITemplate extends Document {
  name: string;
  subject: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/models/Template.ts
git commit -m "feat(templates): track updatedAt on Template model"
```

---

## Task 2: Add the PATCH (edit) route

**Files:**
- Modify: `src/app/api/templates/[id]/route.ts`

CRUD currently has GET/POST/DELETE but no edit. Add `PATCH` reusing the existing `validateTemplateBody` (full-field update, same contract as create).

- [ ] **Step 1: Add the PATCH handler**

In `src/app/api/templates/[id]/route.ts`, update the imports line:

```ts
import { handleError, notFound } from "@/lib/api";
```

to also import the validator:

```ts
import { handleError, notFound } from "@/lib/api";
import { validateTemplateBody } from "@/lib/templates";
```

Then add this handler below the existing `DELETE` function:

```ts
export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const result = validateTemplateBody(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Explicit field pick — never pass the raw body to the model (Task 1.3 pattern)
    const template = await Template.findByIdAndUpdate(
      id,
      {
        name:    result.fields.name,
        subject: result.fields.subject,
        body:    result.fields.body,
      },
      { new: true, runValidators: true }
    ).lean();

    if (!template) return notFound(id);
    return NextResponse.json(template);
  } catch (err) {
    return handleError(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/templates/[id]/route.ts"
git commit -m "feat(templates): add PATCH edit route"
```

---

## Task 3: AI template generation in `draft.ts` (TDD)

**Files:**
- Modify: `src/lib/draft.ts`
- Test: `src/lib/__tests__/templateDraft.test.ts` (create)

Add a NEW pure prompt builder `buildTemplateUserMessage`, an exported `TEMPLATE_SYSTEM_PROMPT` constant, and a `generateTemplateDraft` generator. Do NOT modify `generateEmailDraft` — keep the production send path untouched.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/templateDraft.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/templateDraft.test.ts`
Expected: FAIL — `buildTemplateUserMessage` / `TEMPLATE_SYSTEM_PROMPT` / `TemplateDraftInput` are not exported from `@/lib/draft`.

- [ ] **Step 3: Implement the template helpers**

Append to the END of `src/lib/draft.ts` (after the existing closing comment block). This adds new exports only; nothing above is modified.

```ts
// ---------------------------------------------------------------------------
// Template generation (reusable boilerplate — placeholders PRESERVED)
//
// Distinct from generateEmailDraft above: that produces a finished, per-contact
// email and FORBIDS placeholders. This produces a reusable TEMPLATE and REQUIRES
// {{businessName}} / {{contactName}} tokens so it can be reused across contacts.
//
// NOTE: TEMPLATE_SYSTEM_PROMPT is an intentional first-pass — expected to be
// hand-tuned by the user. Keep it isolated and easy to edit.
// ---------------------------------------------------------------------------

export interface TemplateDraftInput {
  /** Short free-text description of the template's purpose/offer. */
  brief: string;
  /** Optional tone/voice notes (mirrors Campaign.toneNotes shape). */
  tone?: string;
}

/** System prompt for reusable-template generation. First-pass; user will tune. */
export const TEMPLATE_SYSTEM_PROMPT = `You are a cold outreach specialist writing REUSABLE email TEMPLATES for Philippine small businesses. Your output will be saved once and reused across many different businesses, so it must be written with placeholder tokens rather than any specific business or person.

RULES — follow every one, no exceptions:
1. Under ~120 words. Plain text only. Paragraphs separated by a blank line. No HTML, no markdown, no bullet lists.
2. This is a TEMPLATE, not a finished email. Where the recipient's business name belongs, write the exact token {{businessName}}. Where a first name belongs, write the exact token {{contactName}}. Write these tokens EXACTLY, with double curly braces — never real names, never square-bracket placeholders like [Name].
3. Use {{contactName}} sparingly and only where it reads naturally (at send time a friendly fallback is substituted when a contact has no name). {{businessName}} may appear once or twice where natural.
4. Open with something that will feel specific once {{businessName}} is filled in. NEVER open with "I hope this email finds you well" or any generic opener.
5. Respect the tone notes. If they say formal, be formal; if casual, be casual.
6. No spammy phrasing: no ALL CAPS words, no "limited time offer", at most one "!" in the whole email.
7. Warm and direct tone, natural for a Philippine small-business audience.

Use the email_draft tool to return your result.`;

/** Builds the user-turn message for template generation. Pure + testable. */
export function buildTemplateUserMessage(input: TemplateDraftInput): string {
  const tone =
    input.tone && input.tone.trim()
      ? input.tone
      : "(none — default to professional and warm)";
  return [`Brief: ${input.brief}`, `Tone notes: ${tone}`].join("\n");
}

/**
 * Generates a reusable email TEMPLATE (subject + body with placeholders) using
 * Claude via forced tool use. Structured output is guaranteed. Does not persist.
 */
export async function generateTemplateDraft(
  input: TemplateDraftInput
): Promise<{ subject: string; body: string }> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: TEMPLATE_SYSTEM_PROMPT,
    tools: [
      {
        name: "email_draft",
        description:
          "Return the generated reusable email template as structured JSON with subject and body fields.",
        input_schema: {
          type: "object" as const,
          properties: {
            subject: {
              type: "string",
              description:
                "The template subject line. May contain {{businessName}} / {{contactName}} tokens.",
            },
            body: {
              type: "string",
              description:
                "The plain-text template body with {{businessName}} / {{contactName}} tokens. Paragraphs separated by blank lines (\\n\\n). No HTML or markdown.",
            },
          },
          required: ["subject", "body"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "email_draft" },
    messages: [{ role: "user", content: buildTemplateUserMessage(input) }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error(
      `generateTemplateDraft: expected a tool_use block from Claude but received: ${JSON.stringify(response.content)}`
    );
  }

  const input_data = toolBlock.input as Record<string, unknown>;
  const subject =
    typeof input_data.subject === "string" ? input_data.subject.trim() : "";
  const body =
    typeof input_data.body === "string" ? input_data.body.trim() : "";

  if (!subject) {
    throw new Error(
      "generateTemplateDraft: Claude returned an empty subject. Check the prompt or model output."
    );
  }
  if (!body) {
    throw new Error(
      "generateTemplateDraft: Claude returned an empty body. Check the prompt or model output."
    );
  }

  return { subject, body };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/templateDraft.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/draft.ts src/lib/__tests__/templateDraft.test.ts
git commit -m "feat(templates): AI template generation (placeholder-preserving prompt)"
```

---

## Task 4: Add the AI-generate route (no save)

**Files:**
- Create: `src/app/api/templates/generate/route.ts`

Note: a static `generate` segment takes precedence over the sibling `[id]` dynamic segment in Next.js, so `/api/templates/generate` will NOT be captured by `[id]`. Session-cookie auth (`src/proxy.ts`) protects this route automatically — no cron secret.

- [ ] **Step 1: Create the route**

Create `src/app/api/templates/generate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { handleError } from "@/lib/api";
import { generateTemplateDraft } from "@/lib/draft";

export const dynamic = "force-dynamic";

/**
 * POST /api/templates/generate
 *
 * Body: { brief: string, tone?: string }
 * Returns: { subject, body } — a reusable template with {{...}} tokens.
 * Does NOT persist; the client reviews/edits then POSTs to /api/templates.
 * Session-cookie protected via proxy.ts (logged-in browser action).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { brief?: unknown; tone?: unknown };

    if (typeof body.brief !== "string" || body.brief.trim() === "") {
      return NextResponse.json({ error: "brief is required" }, { status: 400 });
    }
    const tone = typeof body.tone === "string" ? body.tone : undefined;

    const { subject, body: draftBody } = await generateTemplateDraft({
      brief: body.brief.trim(),
      tone,
    });

    return NextResponse.json({ subject, body: draftBody });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface a missing API key as a clear 400 (mirrors test/generate-draft)
    if (message.includes("ANTHROPIC_API_KEY")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return handleError(err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/templates/generate/route.ts
git commit -m "feat(templates): add AI-generate route (no save)"
```

---

## Task 5: Templates page

**Files:**
- Create: `src/app/templates/page.tsx`

Editorial Terminal styling; mirrors the Campaigns page (left = list, right = editor panel). The editor panel doubles as create (blank) and edit (pre-filled), and hosts the AI-generate block.

- [ ] **Step 1: Create the page**

Create `src/app/templates/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, Button, inputClass } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY, FOREST_ACTION as FOREST } from "@/components/tokens";
import { apiFetch } from "@/lib/client";

interface TemplateItem {
  _id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Editor state — editingId null = create mode, else edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name,      setName]      = useState("");
  const [subject,   setSubject]   = useState("");
  const [body,      setBody]      = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI-generate state
  const [brief,      setBrief]      = useState("");
  const [tone,       setTone]       = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiFetch<TemplateItem[]>("/api/templates");
    setLoading(false);
    if (err) { setError(err); return; }
    setTemplates(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  function resetEditor() {
    setEditingId(null);
    setName(""); setSubject(""); setBody("");
    setBrief(""); setTone("");
    setSaveError(null); setGenError(null);
  }

  function startEdit(t: TemplateItem) {
    setEditingId(t._id);
    setName(t.name); setSubject(t.subject); setBody(t.body);
    setBrief(""); setTone("");
    setSaveError(null); setGenError(null);
    nameInputRef.current?.focus();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const url = editingId ? `/api/templates/${editingId}` : "/api/templates";
    const method = editingId ? "PATCH" : "POST";
    const { error: err } = await apiFetch(url, {
      method,
      body: JSON.stringify({
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
      }),
    });
    setSaving(false);
    if (err) { setSaveError(err); return; }
    resetEditor();
    loadTemplates();
  }

  async function handleDelete(t: TemplateItem) {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    setDeletingId(t._id);
    const { error: err } = await apiFetch(`/api/templates/${t._id}`, { method: "DELETE" });
    setDeletingId(null);
    if (err) { setError(err); return; }
    if (editingId === t._id) resetEditor();
    loadTemplates();
  }

  async function handleGenerate() {
    if (!brief.trim()) { setGenError("Enter a brief first"); return; }
    setGenerating(true);
    setGenError(null);
    const { data, error: err } = await apiFetch<{ subject: string; body: string }>(
      "/api/templates/generate",
      { method: "POST", body: JSON.stringify({ brief: brief.trim(), tone: tone.trim() }) }
    );
    setGenerating(false);
    if (err || !data) { setGenError(err ?? "Generation failed"); return; }
    setSubject(data.subject);
    setBody(data.body);
  }

  const fieldLabel: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: FAINT2,
    display: "block",
    marginBottom: 7,
  };

  const errText: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: CLAY,
    display: "block",
    marginTop: 10,
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>

      {/* Header */}
      <span style={{ fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 10 }}>
        {templates.length} SAVED TEMPLATE{templates.length === 1 ? "" : "S"}
      </span>
      <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: "0 0 28px", lineHeight: 1.1 }}>
        Templates
      </h1>

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>

        {/* LEFT — list */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {loading && (
            <span style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, textAlign: "center", padding: "56px 0" }}>
              LOADING…
            </span>
          )}
          {!loading && error && (
            <Panel style={{ padding: "22px 28px" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: CLAY, textTransform: "uppercase" }}>{error}</span>
            </Panel>
          )}
          {!loading && !error && templates.length === 0 && (
            <span style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, textAlign: "center", padding: "56px 0" }}>
              NO TEMPLATES YET · CREATE ONE ON THE RIGHT
            </span>
          )}
          {templates.map((t) => (
            <Panel key={t._id} style={{ padding: "20px 26px", ...(editingId === t._id ? { borderColor: FOREST } : {}) }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontFamily: serif, fontSize: 22, color: INK, letterSpacing: "-0.01em" }}>{t.name}</span>
                <span style={{ fontFamily: mono, fontSize: 10, color: FAINT2, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {fmtDate(t.createdAt)}
                </span>
              </div>
              <div style={{ fontFamily: grotesk, fontSize: 15, color: "#2A251C", marginTop: 10 }}>{t.subject}</div>
              <div style={{ fontFamily: grotesk, fontSize: 13.5, color: FAINT2, marginTop: 6, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {t.body}
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 16 }}>
                <button type="button" onClick={() => startEdit(t)} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FOREST, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(t)} disabled={deletingId === t._id} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: CLAY, background: "none", border: "none", cursor: deletingId === t._id ? "not-allowed" : "pointer", padding: 0 }}>
                  {deletingId === t._id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </Panel>
          ))}
        </div>

        {/* RIGHT — editor + AI generate */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <Panel style={{ padding: "26px 28px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 style={{ fontFamily: serif, fontSize: 23, fontWeight: 400, color: INK, margin: 0, letterSpacing: "-0.01em" }}>
                {editingId ? "Edit template" : "New template"}
              </h2>
              {editingId && (
                <button type="button" onClick={resetEditor} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Cancel
                </button>
              )}
            </div>

            {/* AI generate block */}
            <div style={{ marginTop: 18, paddingBottom: 20, borderBottom: "1px solid #E4DBC8" }}>
              <label style={fieldLabel}>AI BRIEF <span style={{ color: "#96712A" }}>· OPTIONAL</span></label>
              <textarea
                className={inputClass}
                rows={2}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Friendly stage-1 intro for a bookkeeping service; mention a free consult"
                style={{ resize: "vertical" }}
              />
              <div style={{ marginTop: 12 }}>
                <label style={fieldLabel}>TONE</label>
                <input
                  className={inputClass}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Warm, casual, Taglish-friendly"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerate}
                disabled={generating || !brief.trim()}
                className="w-full"
                style={{ marginTop: 14 }}
              >
                {generating ? "Generating…" : "Generate with AI"}
              </Button>
              {genError && <span style={errText}>{genError}</span>}
            </div>

            {/* Manual fields */}
            <form onSubmit={handleSave}>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>NAME</label>
                <input
                  ref={nameInputRef}
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bookkeeping intro"
                  required
                />
              </div>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>SUBJECT</label>
                <input
                  className={inputClass}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick question for {{businessName}}"
                  required
                />
              </div>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>BODY</label>
                <textarea
                  className={inputClass}
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Hi {{contactName}}, …"
                  required
                  style={{ resize: "vertical" }}
                />
                <span style={{ fontFamily: mono, fontSize: 10, color: FAINT2, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 6, display: "block" }}>
                  {"TOKENS: {{businessName}} · {{contactName}}"}
                </span>
              </div>

              {saveError && <span style={errText}>{saveError}</span>}

              <Button type="submit" variant="primary" disabled={saving} className="w-full" style={{ marginTop: 22 }}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save template"}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/templates/page.tsx
git commit -m "feat(templates): Templates tab page (CRUD + AI-generate)"
```

---

## Task 6: Add the sidebar nav item

**Files:**
- Modify: `src/components/Sidebar.tsx:8-15`

- [ ] **Step 1: Add the nav entry**

In `src/components/Sidebar.tsx`, replace the `NAV_ITEMS` array:

```ts
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "04", label: "Import",       href: "/import",      showBadge: false },
  { index: "05", label: "Suppressions", href: "/suppressions",showBadge: false },
  { index: "06", label: "Compose",      href: "/compose",     showBadge: false },
];
```

with (adds `07 · Templates`):

```ts
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "04", label: "Import",       href: "/import",      showBadge: false },
  { index: "05", label: "Suppressions", href: "/suppressions",showBadge: false },
  { index: "06", label: "Compose",      href: "/compose",     showBadge: false },
  { index: "07", label: "Templates",    href: "/templates",   showBadge: false },
];
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(templates): add Templates nav item to sidebar"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — the existing suite plus the new `templateDraft.test.ts` cases; no failures.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/templates` and `/api/templates/generate` appear in the route manifest.

- [ ] **Step 4: Commit any incidental fixes**

If steps 1–3 required fixes, commit them:

```bash
git add -A
git commit -m "chore(templates): verification fixes"
```

(If nothing changed, skip this step.)

---

## Self-review notes (verified against the spec)

- **CRUD:** GET/POST/DELETE pre-existed; **PATCH** added (Task 2); list/create/edit/delete UI (Task 5) → full CRUD covered.
- **AI-generate a template:** `generateTemplateDraft` + `TEMPLATE_SYSTEM_PROMPT` (Task 3), `/api/templates/generate` (Task 4), "Generate with AI" button that fills the editable form (Task 5) → covered.
- **Placeholder preservation:** enforced by the distinct prompt + guarded by tests (Task 3) → covered.
- **updatedAt:** Task 1 → covered.
- **Sidebar 7th tab:** Task 6 → covered.
- **Compose left as-is:** no task modifies it (intentional) → matches spec.
- **Tests follow the pure-lib convention** (only Task 3 adds unit tests; routes/page verified via tsc+build) → matches project convention.
- **Type consistency:** `TemplateDraftInput { brief, tone? }` defined in Task 3 is used identically in Task 4; `TemplateItem` shape in Task 5 matches the model (`name/subject/body/createdAt`).
- **Deferred (not in this plan, by design):** contact tags / tag-based campaigns / tag-aware generation — future feature.
```

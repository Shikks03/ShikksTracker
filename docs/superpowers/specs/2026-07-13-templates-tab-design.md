# Templates Tab — Design Spec

**Date:** 2026-07-13
**Status:** Approved for planning
**Feature:** A dedicated "Templates" tab (7th sidebar item) with full template CRUD plus
an "AI-generate a template" capability.

---

## 1. Purpose

Today, email templates (`name / subject / body`) exist only as a side-feature inside the
Compose page: a picker dropdown pre-fills subject/body, and a `window.prompt`-based "Save
as template" creates new ones. There is no way to **edit** or **delete** a template from the
UI, and there is no home for template management.

This feature adds a dedicated Templates tab that owns template CRUD and adds an AI helper
that drafts a reusable template's subject/body from a short brief. The user reviews/edits
the AI output, then saves it like any other template.

**Out of scope (deferred to a future feature):** contact/business **tags** and tag-based
campaign assembly. The AI generator is designed so a tag/segment can later augment the
brief without rework, but no tag functionality is built now.

---

## 2. Current state (as built)

- **Model** `src/models/Template.ts` — `{ name, subject, body, createdAt }`;
  `updatedAt` is currently disabled.
- **API**
  - `GET /api/templates` — list, newest first.
  - `POST /api/templates` — create (validated via `validateTemplateBody`).
  - `DELETE /api/templates/[id]` — delete.
  - **No edit route exists.**
- **Validation** `src/lib/templates.ts` — `validateTemplateBody(raw)` trims and requires
  `name`, `subject`, `body`. Unit-tested in `src/lib/__tests__/templates.test.ts`.
- **AI drafting** `src/lib/draft.ts` — `generateEmailDraft(input)` uses forced tool use to
  produce a **per-contact** email. Its system prompt explicitly **forbids placeholders**
  (`[Name]`, `[Company]`, `{{...}}`) because it fills in real names. This prompt is NOT
  reusable for template generation.
- **UI** — templates only appear inside `src/app/compose/page.tsx`. No dedicated page.
- **Sidebar** `src/components/Sidebar.tsx` — 6 nav items (`01`–`06`).
- **Auth** — `src/proxy.ts` session-cookie middleware protects all pages/APIs except a
  fixed public whitelist (`/api/track/*`, `/api/cron/*`, `/api/test/*`, `/api/health`,
  `/login`, `/api/auth/login`, static). A new `/api/templates/*` route is therefore
  session-protected automatically — no cron secret needed.

---

## 3. Design

### 3.1 Data & API changes

- **`Template` model:** enable `updatedAt` (`timestamps: { createdAt: true, updatedAt:
  true }`) now that editing exists. No other schema change.
- **New `PATCH /api/templates/[id]`** — edit an existing template. Reuses
  `validateTemplateBody` for a full-field update (name/subject/body all required, matching
  the create contract). Explicit field pick — never pass the raw body to the model.
  Returns the updated document; `notFound(id)` if missing. Follows the existing thin-route
  + `handleError` convention.
- **New `POST /api/templates/generate`** — body `{ brief: string, tone?: string }`.
  Validates that `brief` is a non-empty string. Calls the new `generateTemplateDraft`
  lib function and returns `{ subject, body }`. **Does not persist anything** — the client
  reviews/edits, then calls `POST /api/templates` to save. Surfaces a missing-API-key
  error as a 400 with a clear message (mirrors `/api/test/generate-draft`).

### 3.2 AI template generation (`src/lib/draft.ts`)

Add `generateTemplateDraft({ brief, tone })`:

- **Distinct system prompt** from `generateEmailDraft`. Key differences:
  - The output is a **reusable template**, so it **must include** `{{businessName}}` and
    (optionally) `{{contactName}}` placeholders where a name would naturally appear —
    the exact opposite of the per-contact prompt's "no placeholders" rule.
  - `{{contactName}}` should be used sparingly and only where it reads naturally, since a
    fallback ("there") is substituted at send time when a contact has no name.
  - Retain the existing quality rules: under ~120 words, plain text, no spammy phrasing,
    natural tone for a Philippine small-business audience, respect the `tone` input.
- **Same mechanics** as `generateEmailDraft`: forced tool use (`tool_choice: {type:
  "tool", name: "email_draft"}`) returning structured `{ subject, body }`; same model
  env var (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`); same empty-field guards.
- A shared `buildTemplateUserMessage({ brief, tone })` builds the user turn (brief + tone
  lines), kept as a pure, unit-testable function like `buildUserMessage`.

### 3.3 Templates page — `src/app/templates/page.tsx` (`"use client"`)

Editorial Terminal styling using `src/components/ui.tsx` primitives and
`src/components/tokens.ts` (inline style objects + hex literals, per project convention).

- **Header:** mono label `TEMPLATES`, serif title `Templates`.
- **List section:** existing templates rendered as rows/cards showing name, subject,
  a body snippet, and created date. Each row has **Edit** and **Delete** (Delete asks for
  confirmation). Empty state when there are none.
- **Create / Edit panel:** fields `name`, `subject`, `body`, plus the
  `{{businessName}} · {{contactName}}` token hint (reuse the compose page's note styling).
  A single panel serves both create (blank) and edit (pre-filled) modes. Save posts to
  `POST` (create) or `PATCH` (edit); list refreshes on success.
- **AI-generate block** (inside the create/edit panel): a `brief` textarea + a `tone`
  input + a **"Generate with AI"** button. On click it calls
  `POST /api/templates/generate`, then fills the returned subject/body into the form for
  the user to review and edit before saving. Shows a loading state and a graceful error
  (e.g. "AI draft unavailable — ANTHROPIC_API_KEY not set") without losing form input.

### 3.4 Sidebar

Add a 7th nav item to `NAV_ITEMS` in `src/components/Sidebar.tsx`:
`{ index: "07", label: "Templates", href: "/templates", showBadge: false }`.

### 3.5 Compose page

No functional change. Its template picker keeps reading `GET /api/templates` and now
naturally reflects templates created/edited in the new tab. The existing "Save as
template" shortcut stays (non-breaking, convenient). Per the standing note, we do **not**
extend the compose page further for template management — the new tab owns that.

---

## 4. Testing

Follow the existing pure-lib unit-test convention (`src/lib/__tests__/`, vitest):

- `buildTemplateUserMessage` — brief + tone are included correctly; tone omitted handled.
- `generateTemplateDraft` prompt intent — assert the template system prompt **preserves**
  `{{...}}` placeholders (contrast with `generateEmailDraft`, which forbids them). Where
  the Anthropic call itself is involved, mirror how `draft.test.ts` isolates the pure
  parts (test the message/prompt builders, not a live API call).
- Edit-path validation — `validateTemplateBody` already covers field requirements; add a
  case confirming the PATCH route rejects missing fields the same way POST does (route-level
  or via the shared helper).

Verify with `npm test` + `npx tsc --noEmit` + `npm run build`.

---

## 5. Files touched (summary)

| File | Change |
|---|---|
| `src/models/Template.ts` | enable `updatedAt` |
| `src/app/api/templates/[id]/route.ts` | add `PATCH` (edit) |
| `src/app/api/templates/generate/route.ts` | **new** — AI generate (no save) |
| `src/lib/draft.ts` | add `generateTemplateDraft` + `buildTemplateUserMessage` (template prompt) |
| `src/app/templates/page.tsx` | **new** — Templates tab (list / create / edit / delete / AI-generate) |
| `src/components/Sidebar.tsx` | add `07 · Templates` nav item |
| `src/lib/__tests__/draft.test.ts` (or new file) | template prompt-builder tests |

---

## 6. Deferred (future features, not built now)

- **Contact/business tags** set at import (CSV column + manual) and editable later.
- **Tag-based campaign assembly** — filter/group contacts by tag when building a campaign.
- **Tag-aware template generation** — feed the selected tag/segment into the AI brief.

See memory `tags-segmentation-future-feature`. The AI generator's `brief`-based input is
intentionally shaped so a tag can augment the brief later without redesign.

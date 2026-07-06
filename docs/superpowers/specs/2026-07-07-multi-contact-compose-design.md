# Multi-Contact Compose — Design Spec
**Date:** 2026-07-07
**Status:** Approved
**Branch:** `feature/manual-compose-and-send` (extends the manual compose feature)

## Problem

The `/compose` page currently sends one manually-written email to a single contact. Users need to send the same email to multiple contacts at once (e.g., blast a campaign's whole list). This spec extends compose to multi-contact selection with per-contact placeholder personalization, while reusing the existing approved-log → Review Queue → send-batch pipeline unchanged.

## Scope

- New shared helper `src/lib/compose.ts` — placeholder substitution
- New endpoint `POST /api/email-logs/batch` — creates one approved EmailLog per selected contact
- Rewritten `/compose` page — campaign-filtered contact checklist, placeholder tokens, result summary

Out of scope: AI personalization, CSV-driven recipient lists, per-recipient body editing, scheduling. The single `POST /api/email-logs` endpoint is left intact (still valid, just no longer used by the UI). The send pipeline (`/api/send-batch`, Review Queue) is unchanged.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Contact selection UI | Checklist filtered by campaign, with "select all" |
| Personalization | Placeholder substitution: `{{businessName}}`, `{{contactName}}` |
| Stage handling | Auto per-contact: `stage = currentStage + 1`; skip + report duplicates and completed sequences |

---

## Component 1: `src/lib/compose.ts`

**Purpose:** Pure, unit-testable placeholder substitution shared by the batch endpoint.

```typescript
export interface PlaceholderContact {
  businessName: string;
  contactName?: string | null;
}

/**
 * Replaces {{businessName}} and {{contactName}} tokens (case-sensitive, any
 * surrounding whitespace inside the braces tolerated) with the contact's values.
 * contactName falls back to "there" when the contact has no name.
 * Unknown tokens are left untouched.
 */
export function applyPlaceholders(text: string, contact: PlaceholderContact): string;
```

**Behavior:**
- `{{businessName}}` → `contact.businessName`
- `{{contactName}}` → `contact.contactName` if non-empty, else `"there"`
- Tolerates internal whitespace: `{{ businessName }}` matches too.
- Any other `{{...}}` token is left verbatim (not an error).
- Substitution is applied to BOTH subject and body by the caller.

**Reference regex:** `/\{\{\s*(businessName|contactName)\s*\}\}/g`.

---

## Component 2: `POST /api/email-logs/batch`

**File:** `src/app/api/email-logs/batch/route.ts`

**Purpose:** Create one `approved` EmailLog per selected contact, with placeholder substitution, per-contact stage derivation, and skip-reporting.

**Auth:** None beyond existing session (single-user, matches other routes).

**Request body:**
```json
{ "contactIds": ["<ObjectId>", ...], "subject": "string", "body": "string" }
```

**Validation:**
- `contactIds` must be a non-empty array of strings → else 400.
- `subject` must be a non-empty string → else 400.
- `body` must be a non-empty string → else 400.

**Per-contact logic (loop over contactIds):**
1. Load contact by id. If not found → skip, reason `"contact not found"`.
2. If `contact.status !== "active"` → skip, reason `"contact is <status>"`.
3. Derive `stage = contact.currentStage + 1`. If `stage > 3` → skip, reason `"sequence already complete"`.
4. Check for an existing EmailLog with same `contactId + stage` and `status` in `["approved", "sent"]` → if found, skip, reason `"already has a stage <stage> email"`.
5. Otherwise create EmailLog:
   - `contactId`, `campaignId: contact.campaignId`, `stage`, `status: "approved"`
   - `subject: applyPlaceholders(subject, contact)`
   - `body: applyPlaceholders(body, contact)`
   - increment created count.

**Response (200):**
```json
{
  "created": 4,
  "skipped": [
    { "businessName": "Acme Corp", "reason": "already has a stage 1 email" }
  ]
}
```

**Error handling:** wrap in try/catch → `handleError` from `@/lib/api`. Individual contact failures inside the loop are caught per-iteration and recorded as a skip with the error message (one bad contact never aborts the batch).

---

## Component 3: `/compose` page rewrite

**File:** `src/app/compose/page.tsx` (full rewrite, same Editorial Terminal styling)

**Layout:** single column, max-width 620px, same `page-enter` + padding as before.

**State:**
- `campaigns: {_id, name}[]` — loaded once on mount from `GET /api/campaigns`
- `campaignId: string` — selected campaign
- `contacts: ContactItem[]` — active contacts for the selected campaign
- `checkedIds: Set<string>` — selected contacts
- `subject`, `body`
- `submitting`, `apiError`, `fieldErrors`
- `result: { created: number; skipped: { businessName: string; reason: string }[] } | null`

**Sections:**

1. **Header** — kicker `MANUAL COMPOSE`, H1 `Compose` (unchanged style).

2. **Form panel** (`Panel`, padding 28):
   - **Campaign** — `<select>` listing all campaigns. On change: fetch `GET /api/contacts?campaignId=<id>&status=active`, sort by businessName, populate `contacts`, reset `checkedIds` to empty, clear `result`.
   - **Recipients** — appears once a campaign is selected:
     - A header row: `RECIPIENTS · N SELECTED` + a "Select all / Clear" toggle button (toggles all contacts in the current list).
     - A scrollable checklist (max-height ~220px, overflow auto) of the campaign's active contacts, each a checkbox + `businessName (contactEmail)`.
     - Empty state when the campaign has no active contacts: mono note `NO ACTIVE CONTACTS IN THIS CAMPAIGN`.
   - **Stage note** — small mono line: `STAGE AUTO-ASSIGNED PER CONTACT (NEXT TOUCH)`.
   - **Subject** — single-line input (serif styling as before).
   - **Body** — textarea (grotesk styling as before).
   - **Token hint** — small mono line under the body: `TOKENS: {{businessName}} · {{contactName}}`.
   - **Submit** — full-width primary Button: `Queue N email${N===1?"":"s"} for send` (N = `checkedIds.size`); disabled while submitting OR when `checkedIds.size === 0`.

3. **Validation (client-side)** before submit: campaign selected, ≥1 recipient checked, subject non-empty, body non-empty → show inline field errors.

4. **Submit flow:**
   - POST `/api/email-logs/batch` with `{ contactIds: Array.from(checkedIds), subject: subject.trim(), body: body.trim() }`.
   - On success → store response in `result`. Do NOT auto-redirect.
   - On error → inline error panel (CLAY), stay on page.

5. **Result panel** (shown when `result` is set):
   - Line: `QUEUED <created>` + (if skipped) ` · SKIPPED <skipped.length>`.
   - A list of skipped rows: `<businessName> — <reason>` in CLAY mono.
   - A `Go to Review Queue` Button (`router.push("/review")`).
   - After a successful submit, clear the checklist selection (reset `checkedIds`) and clear subject/body so the form can't be accidentally re-sent, but keep the campaign selected and the result visible.

**Reused primitives:** `Button`, `MonoLabel`, `Panel` from `@/components/ui`; inline hex constants (`INK`, `FAINT`, `CLAY`, `FOREST`) and font vars matching the existing page.

---

## Data flow

```
Compose page
  ├─ GET /api/campaigns            → campaign dropdown
  ├─ GET /api/contacts?campaignId&status=active → recipient checklist
  └─ POST /api/email-logs/batch { contactIds, subject, body }
        └─ per contact: applyPlaceholders + derive stage + dedup
             → create approved EmailLog(s)
        → { created, skipped[] }

Review Queue (unchanged)
  └─ approved strip → POST /api/send-batch → sendOneLog → sent
```

---

## Testing

- **Unit (compose.ts):** `applyPlaceholders` cases — both tokens, missing contactName → "there", internal whitespace, unknown token left intact, no tokens. This is the one piece of pure logic worth a real test; run with the project's runner if present, otherwise verify via a scratch node invocation. (Project currently has no test harness — if none is set up, verification is `tsc --noEmit` + a manual node check of the regex.)
- **Integration:** `npx tsc --noEmit` clean + `npm run build` succeeds (new route `/api/email-logs/batch` appears).
- **Manual smoke:** create a campaign with 2 fresh contacts + 1 already at stage 1 → compose to all three → expect `created: 2`, one skipped ("already has a stage 1 email"); verify both new logs appear in the Review Queue approved strip with substituted names.

---

## Files to create / modify

| Action | Path |
|--------|------|
| Create | `src/lib/compose.ts` |
| Create | `src/app/api/email-logs/batch/route.ts` |
| Rewrite | `src/app/compose/page.tsx` |

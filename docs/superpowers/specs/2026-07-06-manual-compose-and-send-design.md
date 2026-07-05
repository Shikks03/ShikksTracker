# Manual Compose + Send Batch — Design Spec
**Date:** 2026-07-06
**Status:** Approved

## Problem

The sequence engine requires an Anthropic API key to generate drafts. Without it, no EmailLogs are ever created and the send pipeline is completely blocked. This feature adds two things that together make the tool fully operable with zero external dependencies: a manual compose path and a UI-triggered batch send button.

## Scope

- New `/compose` page — write subject/body manually, creates an `approved` EmailLog directly
- New `POST /api/email-logs` — backend endpoint that creates the approved log
- New `POST /api/send-batch` — UI-triggered send of selected approved logs
- Review Queue enhancement — approved strip gains checkboxes + "Send X emails" button

Out of scope: editing sent logs, bulk compose, AI assist inside the compose form, threading for manually composed stage 2/3 emails (threading still requires a prior `rfcMessageId` from a real sent stage-1 log).

---

## Backend

### `POST /api/email-logs`

**Purpose:** Create an EmailLog with `status: "approved"` from a manual compose submission.

**Auth:** None beyond existing session (same pattern as all other API routes — single-user tool).

**Request body:**
```json
{
  "contactId": "<ObjectId>",
  "stage": 1 | 2 | 3,
  "subject": "string",
  "body": "string"
}
```

**Logic:**
1. Validate all four fields present; `stage` must be 1, 2, or 3.
2. Look up contact by `contactId` — 404 if not found.
3. Derive `campaignId` from `contact.campaignId`.
4. Check for an existing EmailLog where `contactId + stage` matches and `status` is `"approved"` or `"sent"` — return 409 if found (prevents duplicate sends).
5. Insert EmailLog: `{ contactId, campaignId, stage, subject, body, status: "approved" }`. All Gmail/tracking fields default to null/0.
6. Return 201 with the created log.

**Error responses:** 400 (validation), 404 (contact not found), 409 (duplicate).

---

### `POST /api/send-batch`

**Purpose:** Send a caller-specified list of approved EmailLogs. Replaces the need for a cron pinger for manual operation.

**Auth:** None beyond existing session (UI-facing, single-user).

**Request body:**
```json
{ "ids": ["<EmailLogId>", ...] }
```

**Logic:**
1. Validate `ids` is a non-empty array of strings.
2. Load all EmailLogs by IDs — skip any that aren't `"approved"` (stale UI state).
3. Check daily cap: count sent logs today (Manila calendar day). If cap already reached, return 429 with `{ error: "Daily cap reached", cap: 15 }`.
4. For each log (up to remaining daily cap):
   a. Load contact. If contact status is not `"active"`, skip with reason `"contact_inactive"`.
   b. Send via `sendGmailMessage` (same function used by the sequence engine).
   c. On success: update EmailLog — `status: "sent"`, `sentAt: now`, populate `gmailThreadId`, `gmailMessageId`, fetch and store `rfcMessageId`. Advance `contact.currentStage`. Set `contact.pipelineStage = "contacted"` if stage 1. Compute `contact.nextSendAt` for the next touch.
   d. On failure: record error, continue to next log.
5. No inter-send delay (manual trigger — user is present).
6. Return 200:
```json
{
  "results": [
    { "id": "<id>", "contactName": "Acme Corp", "subject": "...", "status": "sent" },
    { "id": "<id>", "contactName": "Beta Ltd",  "subject": "...", "status": "failed", "error": "Gmail API error" }
  ],
  "capRemaining": 12
}
```

**Reuse:** Extract the per-log send + post-send update logic from `src/lib/sequence.ts` into a shared helper `sendOneLog(log, contact, gmail)` so both the sequence engine and send-batch call the same code path.

---

## Frontend

### Sidebar

Add `06 · Compose` between `05 · Suppressions` and the bottom section. No badge needed.

### `/compose` page

**Layout:** Single-column, centered at max-width 620px. Same `page-enter` fade-up, same padding pattern as other pages (34px 42px 56px).

**Sections (top to bottom):**

1. **Header**
   - Kicker: `MANUAL COMPOSE` in MonoLabel / FAINT
   - H1: `Compose` in Instrument Serif, 40px

2. **Form panel** (Panel component, padding 28px)
   - **Contact** — dropdown (`<select>`) listing all active contacts as `Business Name (email@example.com)`. Sorted by businessName. On change, auto-sets Stage.
   - **Stage** — three button-chips: `1ST · 2ND · 3RD`. Auto-selects `contact.currentStage + 1` (clamped 1–3) when contact changes. User can override.
   - **Subject** — single-line input, Instrument Serif styling matching the Review Queue edit mode.
   - **Body** — textarea, min-height 260px, Familjen Grotesk styling matching the Review Queue edit mode.
   - **Submit** — full-width primary Button labeled "Queue for send". Disabled while submitting.

3. **Error panel** — shown below the form on API error, same Panel + MonoLabel in CLAY pattern used elsewhere.

**On submit:**
- POST `/api/email-logs` with `{ contactId, stage, subject, body }`.
- On success → `router.push("/review")` (user sees it in the Approved strip immediately).
- On error → show inline error panel, stay on page.

**Validation (client-side):** contact selected, stage selected, subject non-empty, body non-empty. Show inline field errors before submitting.

---

### `/review` page — approved strip enhancement

**Checkboxes:** Each row in the "Approved · Queued for Send" strip gains a checkbox on the left. All checked by default when the strip loads/refreshes.

**Send button:** Appears below the approved strip when ≥1 row is checked. Label: `Send X email(s)` (X = checked count). Primary Button, full width of the strip.

**Send flow:**
1. Button click → POST `/api/send-batch` with `{ ids: [checked log IDs] }`.
2. Button label changes to `Sending…`, disabled.
3. On response: render a results panel above the strip showing each result row — ✓ green for sent, ✗ CLAY for failed with error text.
4. Call `loadAll()` to refresh — sent logs disappear from approved list, draft count in sidebar updates.
5. If 429 (cap reached) → show cap-reached error panel.

**No new page** — this is all inline on the existing Review Queue.

---

## Data flow summary

```
Compose page
  └─ POST /api/email-logs → approved EmailLog in DB

Review Queue (approved strip)
  └─ POST /api/send-batch
       └─ sendOneLog() [extracted from sequence.ts]
            └─ sendGmailMessage()
            └─ update EmailLog: sent + tracking fields
            └─ advance contact.currentStage + nextSendAt
```

---

## What stays the same

- The existing cron endpoint (`/api/cron/sequence`) is untouched. If the user later adds an Anthropic key and sets up a pinger, it works as before.
- Reply detection, open/click tracking, scoring, and takeover alerts are unaffected — they all operate on sent EmailLogs regardless of how the log was created.
- The "no POST /api/email-logs by design" decision is explicitly superseded by this spec.

---

## Files to create / modify

| Action | Path |
|--------|------|
| Create | `src/app/api/email-logs/route.ts` |
| Create | `src/app/api/send-batch/route.ts` |
| Modify | `src/lib/sequence.ts` — extract `sendOneLog` helper |
| Create | `src/app/compose/page.tsx` |
| Modify | `src/app/review/page.tsx` — approved strip checkboxes + send button |
| Modify | `src/components/Sidebar.tsx` — add 06 · Compose nav item |

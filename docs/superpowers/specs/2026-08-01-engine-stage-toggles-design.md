# Engine Stage Toggles — Design Spec

**Date:** 2026-08-01
**Status:** Approved for planning
**Feature:** A `/settings` page with two on/off switches — "Draft generation" and
"Sending" — that gate the cron engine's automated stages, stored server-side so they
apply consistently regardless of which device is used to flip them.

---

## 1. Purpose

The sequence engine (`runSequenceEngine`, `src/lib/sequence.ts`) currently has no
concept of "paused" — whatever the external hourly pinger triggers, happens. Before
setting up that pinger for the first time, the user wants a way to control whether the
automated stages (drafting new AI emails, sending approved ones) actually do anything,
without needing to touch the pinger's own configuration (cron-job.org / GitHub Actions)
every time.

This also enables a safe "warm-up" workflow: turn draft generation on, let a small batch
of drafts get created and reviewed, then turn sending on once the drafts look right and
the user is ready to build up real sending history on the Gmail account.

**Out of scope:**
- Gating manual sends (Review Queue's batch-send button, `/compose`) — those stay
  always-on; they're already deliberate one-at-a-time human actions.
- Gating stale-sweep or reply-check — both always run regardless of these toggles
  (reply-check is what drives the takeover alert the user relies on; stale-sweep is
  cleanup, not a "does something new" action).
- Surfacing toggle state on the main dashboard — confirmed out of scope, the Settings
  page is the only place this is shown.

---

## 2. Current state (as built)

- `runSequenceEngine()` runs four stages unconditionally: `sweepStaleSendingLogs()` →
  `checkReplies()` → `generateDrafts()` → `sendApproved(runStartMs)` — then a 5th,
  `sendActionReminders()`, after the `CronRun` doc is persisted.
- `RunSummary` (`src/lib/sequence.ts:1038`) has no concept of a stage being
  intentionally skipped — `draftsCreated: 0` today only ever means "nothing was due."
- No `Settings`-like model exists (`src/models/` has Campaign, Contact, EmailLog,
  Suppression, Template, LoginAttempt, CronRun — no global config singleton).
- No `/settings` page or nav entry exists; `src/components/Sidebar.tsx`'s `NAV_ITEMS`
  currently ends at `08 · Templates`.
- Every mutating API route follows the same pattern: `requireSession(request)` first
  (covers both auth and the CSRF Origin check), then an explicit field-pick from the
  parsed body (never a raw `Model.create(body)`/`findByIdAndUpdate(body)`).

---

## 3. Data model

New file `src/models/Settings.ts`:

```ts
interface ISettings extends Document {
  draftGenerationEnabled: boolean; // default false
  sendingEnabled: boolean;         // default false
  updatedAt: Date;
}
```

Singleton pattern: exactly one document ever exists. No natural key is needed (this
mirrors nothing else in the schema, so a fixed known `_id` isn't necessary) — the access
layer below finds any existing doc and creates one on first read if none exists.

Add to `src/models/index.ts` alongside the other model re-exports.

---

## 4. Access layer — `src/lib/settings.ts`

```ts
export async function getSettings(): Promise<ISettings> // find-or-create
export async function updateSettings(patch: {
  draftGenerationEnabled?: boolean;
  sendingEnabled?: boolean;
}): Promise<ISettings>
```

`getSettings()` does a `findOne()`; if null, `create({})` (schema defaults apply — both
fields `false`) and returns that. This means no separate migration/seed step is needed;
the first call from either the API route or the engine creates the row.

`updateSettings()` builds an explicit field-pick object from only the two known keys
(same whitelist convention as every other route) and does a `findOneAndUpdate` with
`upsert: true` so it's safe even if called before any document exists.

---

## 5. Engine integration — `src/lib/sequence.ts`

In `runSequenceEngine()`, immediately after `connectDB()`:

```ts
const settings = await getSettings();
```

Stage 0 (`sweepStaleSendingLogs`) and Stage A (`checkReplies`) are called exactly as
today, unconditionally.

Stage B becomes conditional:
```ts
const draftsResult = settings.draftGenerationEnabled
  ? await generateDrafts()
  : { created: 0, errors: [] }; // same shape generateDrafts() already returns on a no-op run
```

Stage C becomes conditional the same way:
```ts
const sendsResult = settings.sendingEnabled
  ? await sendApproved(runStartMs)
  : { sent: 0, skipped: [], errors: [] };
```

`RunSummary` gains two fields so a paused stage is distinguishable from an active stage
that simply had nothing to do:
```ts
draftGenerationEnabled: boolean;
sendingEnabled: boolean;
```
These get threaded through both `CronRun.create(...)` calls (the early-return path on
persist failure, and the final persisted summary) exactly like the existing
`actionRemindersDue`/`actionDigestSent` fields are.

No changes to `sendActionReminders`, `sendOneLog`, `/api/send-batch`, or any compose/
review-queue path — all manual and reply-driven behavior is untouched.

---

## 6. API — `src/app/api/settings/route.ts`

- **`GET`** — `requireSession` guard, `await getSettings()`, return the doc (lean or
  plain, matching the convention other single-resource GETs use).
- **`PATCH`** — `requireSession` guard (auth + Origin/CSRF check, same as every other
  mutating route), parse body, validate that `draftGenerationEnabled`/`sendingEnabled`
  (if present) are booleans (reject non-boolean with 400 — same defensive style as
  `campaigns/route.ts`'s `toneNotes` type guard), call `updateSettings(picked)`, return
  the updated doc.

No `POST`/`DELETE` — there is only ever one settings document, so create/delete aren't
meaningful operations here.

---

## 7. UI — `/settings` page + nav entry

New `src/app/settings/page.tsx`, `"use client"`, following the existing inline-style +
`ui.tsx`-primitive + `tokens.ts` convention (same as `/campaigns`, `/suppressions`):

- Fetches current settings on mount via `apiFetch<Settings>("/api/settings")`
  (`src/lib/client.ts`).
- Two toggle rows, each: a label, a one-line caption, and a switch control:
  - **Draft generation** — "Cron will draft new outreach emails for contacts whose
    `nextSendAt` is due."
  - **Sending** — "Cron will send previously-approved drafts during the 8am–6pm Manila
    window."
- Flipping a switch immediately `PATCH`es `/api/settings` with just that one field and
  updates local state on success; a failed PATCH reverts the switch and shows an inline
  error (same error-surfacing pattern Task 5.1 established elsewhere — no silent
  `.catch(() => {})`).

`src/components/Sidebar.tsx`: add `{ index: "09", label: "Settings", href: "/settings",
showBadge: false }` to `NAV_ITEMS`.

---

## 8. Testing

- `src/lib/__tests__/settings.test.ts` (new): `getSettings()` creates a default doc on
  first call and returns the same doc on subsequent calls; `updateSettings()` only
  touches the two whitelisted fields and upserts if no doc exists yet.
- `src/lib/__tests__/sequence.test.ts` (existing): add cases confirming
  `generateDrafts()`/`sendApproved()` are not invoked (or their results are zeroed) when
  the corresponding setting is `false`, and that `RunSummary.draftGenerationEnabled`/
  `sendingEnabled` reflect the setting used for that run.
- Existing 566 tests must stay green; `npx tsc --noEmit` and `npm run build` must pass.

---

## 9. Non-goals (confirmed with user)

- No per-stage toggle for stale-sweep or reply-check.
- No gating of manual send paths.
- No dashboard-level visibility of toggle state (Settings page is the only surface).
- No env-var fallback/override — this is DB-only by design, so it works identically
  regardless of which device or deploy the user is looking at it from.

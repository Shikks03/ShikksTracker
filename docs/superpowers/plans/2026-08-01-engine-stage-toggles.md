# Engine Stage Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/settings` page with two DB-backed on/off switches — "Draft generation"
and "Sending" — that gate the cron engine's two automated stages, so the user can pause
either one from any device without touching the cron pinger's own configuration.

**Architecture:** A new singleton `Settings` MongoDB document (one row, two booleans,
both default `false`) is the single source of truth. `src/lib/settings.ts` is a thin
find-or-create/upsert access layer. `runSequenceEngine()` reads it once per run and
skips `generateDrafts()`/`sendApproved()` when their flag is off, substituting a
zero-result object so the rest of the run (persistence, digests, action reminders)
behaves exactly as it does today. A new `/api/settings` route (session-guarded, same
pattern as every other mutating route) exposes GET/PATCH; a new `/settings` page renders
two toggle rows. Manual send paths (`/api/send-batch`, `/compose`, Outreach mark-sent)
are untouched — confirmed out of scope.

**Tech Stack:** Next.js App Router route handlers, Mongoose, the existing
`src/components/ui.tsx` / `tokens.ts` inline-style design system, vitest with `vi.mock`
over model modules (this codebase's existing test convention — no mongodb-memory-server
anywhere in the repo).

**Reference spec:** `docs/superpowers/specs/2026-08-01-engine-stage-toggles-design.md`

---

### Task 1: `Settings` model

**Files:**
- Create: `src/models/Settings.ts`
- Modify: `src/models/index.ts`

- [ ] **Step 1: Create the model**

```ts
// src/models/Settings.ts
import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
  draftGenerationEnabled: boolean;
  sendingEnabled: boolean;
  updatedAt: Date;
}

// Singleton: exactly one document ever exists (see src/lib/settings.ts, which
// always queries with an empty filter `{}`). Both flags default to false so
// that shipping this feature does not silently turn on automated drafting or
// sending — the user opts in explicitly per stage from /settings.
const SettingsSchema = new Schema<ISettings>(
  {
    draftGenerationEnabled: { type: Boolean, required: true, default: false },
    sendingEnabled:         { type: Boolean, required: true, default: false },
  },
  { timestamps: { createdAt: false, updatedAt: true }, strict: true }
);

const Settings =
  (mongoose.models.Settings as mongoose.Model<ISettings>) ||
  mongoose.model<ISettings>("Settings", SettingsSchema);

export default Settings;
```

- [ ] **Step 2: Export it from the model barrel**

Modify `src/models/index.ts` — add these two lines at the end, following the exact
pattern every other model uses:

```ts
export { default as Settings } from "./Settings";
export type { ISettings } from "./Settings";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/models/Settings.ts src/models/index.ts
git commit -m "feat(settings): add Settings singleton model"
```

---

### Task 2: Access layer — `src/lib/settings.ts`

**Files:**
- Create: `src/lib/settings.ts`
- Test: `src/lib/__tests__/settings.test.ts`

This follows the same `vi.mock("@/models/X", ...)` convention already used in
`src/lib/__tests__/sequence.test.ts` for `Contact`/`EmailLog`/`Campaign` — this
codebase has no mongodb-memory-server or other live-DB test infrastructure anywhere.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/settings.test.ts
/**
 * Unit tests for src/lib/settings.ts. Mocks @/models/Settings (same convention
 * as the Contact/EmailLog/Campaign mocks in sequence.test.ts) since this repo
 * has no live-DB test infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/models/Settings", () => ({
  default: { findOneAndUpdate: vi.fn() },
}));

import Settings from "@/models/Settings";
import { getSettings, updateSettings } from "@/lib/settings";

const mockFindOneAndUpdate = Settings.findOneAndUpdate as unknown as Mock;

beforeEach(() => {
  mockFindOneAndUpdate.mockReset();
});

describe("getSettings", () => {
  it("returns the existing singleton unchanged via an empty $set", async () => {
    const existing = { draftGenerationEnabled: true, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(existing);

    const result = await getSettings();

    expect(result).toBe(existing);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: {} },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("upserts (creates with schema defaults) when no document exists yet", async () => {
    const created = { draftGenerationEnabled: false, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(created);

    const result = await getSettings();

    expect(result).toBe(created);
    const [, , options] = mockFindOneAndUpdate.mock.calls[0];
    expect(options).toMatchObject({ upsert: true, setDefaultsOnInsert: true });
  });
});

describe("updateSettings", () => {
  it("passes only the given field through to $set", async () => {
    const updated = { draftGenerationEnabled: true, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(updated);

    const result = await updateSettings({ draftGenerationEnabled: true });

    expect(result).toBe(updated);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: { draftGenerationEnabled: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("passes both fields through to $set when both are given", async () => {
    const updated = { draftGenerationEnabled: true, sendingEnabled: true };
    mockFindOneAndUpdate.mockResolvedValue(updated);

    await updateSettings({ draftGenerationEnabled: true, sendingEnabled: true });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: { draftGenerationEnabled: true, sendingEnabled: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("passes an empty $set when called with no fields", async () => {
    const unchanged = { draftGenerationEnabled: false, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(unchanged);

    await updateSettings({});

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: {} },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/settings.test.ts`
Expected: FAIL — `Cannot find module '@/lib/settings'` (the module doesn't exist yet).

- [ ] **Step 3: Implement**

```ts
// src/lib/settings.ts
/**
 * settings.ts — access layer for the singleton engine-control Settings doc.
 *
 * Both getSettings() and updateSettings() go through the same atomic
 * findOneAndUpdate with upsert:true — getSettings() is just updateSettings({})
 * (an empty $set changes nothing on an existing doc, and upsert still creates
 * one with schema defaults if none exists). This avoids a separate
 * find-then-create path that could race with a concurrent first call.
 *
 * Callers (the /api/settings route, runSequenceEngine) are responsible for
 * calling connectDB() first — same convention as the per-run helpers in
 * src/lib/sequence.ts.
 */

import Settings from "@/models/Settings";
import type { ISettings } from "@/models/Settings";

export interface SettingsPatch {
  draftGenerationEnabled?: boolean;
  sendingEnabled?: boolean;
}

export async function updateSettings(patch: SettingsPatch): Promise<ISettings> {
  const updated = await Settings.findOneAndUpdate(
    {},
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return updated as ISettings;
}

export async function getSettings(): Promise<ISettings> {
  return updateSettings({});
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/settings.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/__tests__/settings.test.ts
git commit -m "feat(settings): add getSettings/updateSettings access layer"
```

---

### Task 3: Engine integration — gate drafting/sending in `runSequenceEngine`

**Files:**
- Modify: `src/lib/sequence.ts`

This task has no new unit tests: `generateDrafts`, `sendApproved`, and
`runSequenceEngine` are not unit-tested anywhere in this codebase today (they're not
exported for testing and would require mocking Contact/EmailLog/Campaign/CronRun/Gmail/
Suppression together) — that's a pre-existing boundary, not something introduced here.
Verification is the type-checker, the full existing suite staying green, and a manual
cron smoke test below that proves the "off" path does nothing (the safety-critical
direction — the "on" path is just the pre-existing, already-tested behavior).

- [ ] **Step 1: Add the import**

Modify `src/lib/sequence.ts` — after the existing `generateEmailDraft` import (around
line 16), add:

```ts
import { getSettings } from "@/lib/settings";
```

- [ ] **Step 2: Extend `RunSummary`**

Find (around line 1038):
```ts
export interface RunSummary {
  staleSendingReverted: number;
  repliesChecked: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
  draftsCreated: number;
  sent: number;
  skipped: string[];
  errors: string[];
  /** Number of contacts with nextActionAt <= now at the time of this run. */
  actionRemindersDue: number;
  /** True if an action-reminder digest email was sent this run. */
  actionDigestSent: boolean;
}
```

Replace with:
```ts
export interface RunSummary {
  staleSendingReverted: number;
  repliesChecked: number;
  replied: number;
  unsubscribed: number;
  bounced: number;
  draftsCreated: number;
  sent: number;
  skipped: string[];
  errors: string[];
  /** Number of contacts with nextActionAt <= now at the time of this run. */
  actionRemindersDue: number;
  /** True if an action-reminder digest email was sent this run. */
  actionDigestSent: boolean;
  /** False when this run skipped drafting because /settings has it turned off. */
  draftGenerationEnabled: boolean;
  /** False when this run skipped sending because /settings has it turned off. */
  sendingEnabled: boolean;
}
```

- [ ] **Step 3: Fetch settings and gate stages B/C**

Find (around line 1284):
```ts
  // A: Check replies (Phase 9 stub)
  const repliesResult = await checkReplies();

  // B: Generate drafts
  const draftsResult = await generateDrafts();

  // C: Send approved
  const sendsResult = await sendApproved(runStartMs);
```

Replace with:
```ts
  // A: Check replies (Phase 9 stub)
  const repliesResult = await checkReplies();

  const settings = await getSettings();

  // B: Generate drafts (skipped when /settings has drafting turned off)
  const draftsResult = settings.draftGenerationEnabled
    ? await generateDrafts()
    : { created: 0, errors: [] };

  // C: Send approved (skipped when /settings has sending turned off)
  const sendsResult = settings.sendingEnabled
    ? await sendApproved(runStartMs)
    : { sent: 0, skipped: [], errors: [] };
```

- [ ] **Step 4: Thread the two new fields into the CronRun-create summary + its
      persist-failure fallback**

Find (around line 1298):
```ts
  // Persist the CronRun doc — must not throw out of the engine.
  let cronRunId: string | null = null;
  try {
    const cronRun = await CronRun.create({
      startedAt,
      durationMs,
      summary: {
        staleSendingReverted: sweepResult.reverted,
        repliesChecked: repliesResult.checked,
        replied: repliesResult.replied,
        unsubscribed: repliesResult.unsubscribed,
        bounced: repliesResult.bounced,
        draftsCreated: draftsResult.created,
        sent: sendsResult.sent,
        skipped: sendsResult.skipped,
        errors: partialErrors,
        actionRemindersDue: 0,
        actionDigestSent: false,
      } satisfies RunSummary,
      errorCount,
      digestSentAt: null,
      actionDigestSentAt: null,
    });
    cronRunId = String(cronRun._id);
  } catch (persistErr) {
    console.error("[sequence] CronRun persist failed:", persistErr);
    // Logging failure must not crash the engine — return summary as-is.
    return {
      staleSendingReverted: sweepResult.reverted,
      repliesChecked: repliesResult.checked,
      replied: repliesResult.replied,
      unsubscribed: repliesResult.unsubscribed,
      bounced: repliesResult.bounced,
      draftsCreated: draftsResult.created,
      sent: sendsResult.sent,
      skipped: sendsResult.skipped,
      errors: partialErrors,
      actionRemindersDue: 0,
      actionDigestSent: false,
    };
  }
```

Replace with (only the two new lines in each of the two `RunSummary`-shaped object
literals are new):
```ts
  // Persist the CronRun doc — must not throw out of the engine.
  let cronRunId: string | null = null;
  try {
    const cronRun = await CronRun.create({
      startedAt,
      durationMs,
      summary: {
        staleSendingReverted: sweepResult.reverted,
        repliesChecked: repliesResult.checked,
        replied: repliesResult.replied,
        unsubscribed: repliesResult.unsubscribed,
        bounced: repliesResult.bounced,
        draftsCreated: draftsResult.created,
        sent: sendsResult.sent,
        skipped: sendsResult.skipped,
        errors: partialErrors,
        actionRemindersDue: 0,
        actionDigestSent: false,
        draftGenerationEnabled: settings.draftGenerationEnabled,
        sendingEnabled: settings.sendingEnabled,
      } satisfies RunSummary,
      errorCount,
      digestSentAt: null,
      actionDigestSentAt: null,
    });
    cronRunId = String(cronRun._id);
  } catch (persistErr) {
    console.error("[sequence] CronRun persist failed:", persistErr);
    // Logging failure must not crash the engine — return summary as-is.
    return {
      staleSendingReverted: sweepResult.reverted,
      repliesChecked: repliesResult.checked,
      replied: repliesResult.replied,
      unsubscribed: repliesResult.unsubscribed,
      bounced: repliesResult.bounced,
      draftsCreated: draftsResult.created,
      sent: sendsResult.sent,
      skipped: sendsResult.skipped,
      errors: partialErrors,
      actionRemindersDue: 0,
      actionDigestSent: false,
      draftGenerationEnabled: settings.draftGenerationEnabled,
      sendingEnabled: settings.sendingEnabled,
    };
  }
```

- [ ] **Step 5: Thread the two new fields into the final summary object**

Find (around line 1351):
```ts
  const summary: RunSummary = {
    staleSendingReverted: sweepResult.reverted,
    repliesChecked: repliesResult.checked,
    replied: repliesResult.replied,
    unsubscribed: repliesResult.unsubscribed,
    bounced: repliesResult.bounced,
    draftsCreated: draftsResult.created,
    sent: sendsResult.sent,
    skipped: sendsResult.skipped,
    errors: [...partialErrors, ...actionRemindersResult.errors],
    actionRemindersDue: actionRemindersResult.due,
    actionDigestSent: actionRemindersResult.digestSent,
  };
```

Replace with:
```ts
  const summary: RunSummary = {
    staleSendingReverted: sweepResult.reverted,
    repliesChecked: repliesResult.checked,
    replied: repliesResult.replied,
    unsubscribed: repliesResult.unsubscribed,
    bounced: repliesResult.bounced,
    draftsCreated: draftsResult.created,
    sent: sendsResult.sent,
    skipped: sendsResult.skipped,
    errors: [...partialErrors, ...actionRemindersResult.errors],
    actionRemindersDue: actionRemindersResult.due,
    actionDigestSent: actionRemindersResult.digestSent,
    draftGenerationEnabled: settings.draftGenerationEnabled,
    sendingEnabled: settings.sendingEnabled,
  };
```

- [ ] **Step 6: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all existing tests still pass (no test asserts on the exact shape of a
`RunSummary` literal elsewhere — `CronRun.summary` is `Schema.Types.Mixed`, so no schema
migration is needed either).

- [ ] **Step 7: Manual smoke test — confirm the "off" path does nothing**

This is the safety-critical direction to prove: with both settings at their shipped
default (`false`), a cron run must not create drafts or send anything, and must say so
in its summary.

Start the dev server: `npm run dev`

In another terminal, read your local cron secret (do not paste the value itself
anywhere — this just uses it):
```bash
CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)
curl -s -X POST http://localhost:3000/api/cron/sequence -H "x-cron-secret: $CRON_SECRET"
```

Expected JSON response includes:
```json
{
  "draftGenerationEnabled": false,
  "sendingEnabled": false,
  "draftsCreated": 0,
  "sent": 0
}
```
(other fields will vary depending on existing contacts/replies — those two booleans and
the two zero counts are what this step is checking).

- [ ] **Step 8: Commit**

```bash
git add src/lib/sequence.ts
git commit -m "feat(settings): gate draft generation and sending behind /settings"
```

---

### Task 4: API route — `src/app/api/settings/route.ts`

**Files:**
- Create: `src/app/api/settings/route.ts`

No dedicated route test — this codebase has no API-route-level tests anywhere (only the
`src/lib/` layer is unit-tested); the `requireSession` + `connectDB` + `handleError`
pattern here is copied verbatim from `src/app/api/templates/route.ts`, which is already
proven correct in production. End-to-end verification happens through the browser in
Task 5, which exercises this route for real.

- [ ] **Step 1: Write the route**

```ts
// src/app/api/settings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const patch: { draftGenerationEnabled?: boolean; sendingEnabled?: boolean } = {};

    if (body.draftGenerationEnabled !== undefined) {
      if (typeof body.draftGenerationEnabled !== "boolean") {
        return NextResponse.json(
          { error: "draftGenerationEnabled must be a boolean" },
          { status: 400 }
        );
      }
      patch.draftGenerationEnabled = body.draftGenerationEnabled;
    }

    if (body.sendingEnabled !== undefined) {
      if (typeof body.sendingEnabled !== "boolean") {
        return NextResponse.json(
          { error: "sendingEnabled must be a boolean" },
          { status: 400 }
        );
      }
      patch.sendingEnabled = body.sendingEnabled;
    }

    const settings = await updateSettings(patch);
    return NextResponse.json(settings);
  } catch (err) {
    return handleError(err);
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat(settings): add GET/PATCH /api/settings route"
```

---

### Task 5: UI — `/settings` page + Sidebar nav entry

**Files:**
- Create: `src/app/settings/page.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add the nav entry**

Modify `src/components/Sidebar.tsx` — find:
```ts
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Outreach",     href: "/outreach",    showBadge: false },
  { index: "04", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "05", label: "Import",       href: "/import",      showBadge: false },
  { index: "06", label: "Suppressions", href: "/suppressions",showBadge: false },
  { index: "07", label: "Compose",      href: "/compose",     showBadge: false },
  { index: "08", label: "Templates",    href: "/templates",   showBadge: false },
];
```

Replace with:
```ts
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Outreach",     href: "/outreach",    showBadge: false },
  { index: "04", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "05", label: "Import",       href: "/import",      showBadge: false },
  { index: "06", label: "Suppressions", href: "/suppressions",showBadge: false },
  { index: "07", label: "Compose",      href: "/compose",     showBadge: false },
  { index: "08", label: "Templates",    href: "/templates",   showBadge: false },
  { index: "09", label: "Settings",     href: "/settings",    showBadge: false },
];
```

- [ ] **Step 2: Write the page**

```tsx
// src/app/settings/page.tsx
"use client";

import { useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT } from "@/components/tokens";
import { apiFetch } from "@/lib/client";

interface Settings {
  draftGenerationEnabled: boolean;
  sendingEnabled: boolean;
}

type SettingsField = keyof Settings;

interface ToggleRowProps {
  label: string;
  caption: string;
  enabled: boolean;
  pending: boolean;
  last?: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, caption, enabled, pending, last, onToggle }: ToggleRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "18px 0",
        borderBottom: last ? "none" : "1px solid #E3DAC5",
      }}
    >
      <div>
        <div style={{ fontFamily: grotesk, fontSize: 17, color: INK, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontFamily: grotesk, fontSize: 13.5, color: FAINT, maxWidth: 420 }}>
          {caption}
        </div>
      </div>
      <Button
        variant={enabled ? "primary" : "outline"}
        onClick={onToggle}
        disabled={pending}
        style={{ minWidth: 76, flexShrink: 0 }}
      >
        {enabled ? "ON" : "OFF"}
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<SettingsField | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: err } = await apiFetch<Settings>("/api/settings");
      if (cancelled) return;
      if (err) setError(err);
      else setSettings(data);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(field: SettingsField) {
    if (!settings || pendingField) return;
    setPendingField(field);
    setError(null);
    const { data, error: err } = await apiFetch<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ [field]: !settings[field] }),
    });
    setPendingField(null);
    if (err) {
      setError(err);
      return;
    }
    setSettings(data);
  }

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>
      <span
        style={{
          fontFamily: mono,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: FAINT,
          display: "block",
          marginBottom: 10,
        }}
      >
        ENGINE CONTROL
      </span>
      <h1
        style={{
          fontFamily: serif,
          fontSize: 40,
          fontWeight: 400,
          color: INK,
          letterSpacing: "-0.01em",
          margin: "0 0 28px",
          lineHeight: 1.1,
        }}
      >
        Settings
      </h1>

      {loading && (
        <div style={{ fontFamily: grotesk, color: FAINT }}>Loading…</div>
      )}

      {error && (
        <div
          style={{
            fontFamily: grotesk,
            fontSize: 14,
            color: "#A23B28",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {settings && (
        <Panel style={{ padding: "6px 24px", maxWidth: 640 }}>
          <ToggleRow
            label="Draft generation"
            caption="Cron will draft new outreach emails for contacts whose next send is due."
            enabled={settings.draftGenerationEnabled}
            pending={pendingField === "draftGenerationEnabled"}
            onToggle={() => handleToggle("draftGenerationEnabled")}
          />
          <ToggleRow
            label="Sending"
            caption="Cron will send previously-approved drafts during the 8am–6pm Manila window. Manual sends (Review Queue, Compose) are not affected by this switch."
            enabled={settings.sendingEnabled}
            pending={pendingField === "sendingEnabled"}
            last
            onToggle={() => handleToggle("sendingEnabled")}
          />
        </Panel>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual end-to-end verification in the browser**

With `npm run dev` running and you logged into the dashboard already:

1. Navigate to `/settings`. Confirm both switches render and show **OFF** (the shipped
   default).
2. Click the "Draft generation" switch. Confirm it flips to **ON** with no error, then
   reload the page — confirm it's still **ON** (proves the PATCH persisted, not just
   local state).
3. Click "Sending" — same check.
4. Open the same URL in a different browser (or an incognito window, logging in again)
   — confirm both show the state you just set, proving it's server-side, not per-browser.
5. Turn both back to **OFF** when done (matches the shipped default; avoids leaving
   automated sending armed while you're mid-setup on the pinger).

- [ ] **Step 5: Commit**

```bash
git add src/app/settings/page.tsx src/components/Sidebar.tsx
git commit -m "feat(settings): add /settings page with draft/send toggles"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass, count is the prior total (566) + 7 new (settings.test.ts) = 573.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; note the new `/settings` and `/api/settings` routes appear in
the route list output.

- [ ] **Step 4: Update SESSION_NOTES.md**

Add a dated entry under the Session Log describing this feature (model/access-layer/
engine-gating/route/page files touched, default-off behavior, manual-send paths
unaffected) — follow the existing entry format/tone in that file.

- [ ] **Step 5: Commit**

```bash
git add SESSION_NOTES.md
git commit -m "docs: record engine stage toggles in SESSION_NOTES"
```

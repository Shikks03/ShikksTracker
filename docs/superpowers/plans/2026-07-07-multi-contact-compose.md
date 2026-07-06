# Multi-Contact Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `/compose` page send one manually-written email (with per-contact placeholder substitution) to many contacts at once, selected from a campaign-filtered checklist.

**Architecture:** A pure `applyPlaceholders` helper does token substitution; a new `POST /api/email-logs/batch` endpoint loops selected contacts (substitute → derive stage → dedup → create approved log) and returns a created/skipped summary; the `/compose` page is rewritten to a campaign-filtered recipient checklist that calls the batch endpoint and shows an inline result summary. The existing send pipeline (`/api/send-batch`, Review Queue) is untouched.

**Tech Stack:** Next.js App Router, TypeScript, MongoDB/Mongoose, React client components, existing `@/components/ui` primitives.

**Note on testing:** This project has no test runner (all phases verified via `tsc --noEmit` + `npm run build`, per SESSION_NOTES.md). Do NOT add a test framework. The one piece of pure logic (`applyPlaceholders`) is verified with a scratch `node` script exercising its exact regex/fallback behavior; everything else is verified by the TypeScript compiler and the production build.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/compose.ts` | `applyPlaceholders` — pure token substitution |
| Create | `src/app/api/email-logs/batch/route.ts` | Batch create approved logs from selected contacts |
| Rewrite | `src/app/compose/page.tsx` | Campaign-filtered recipient checklist + batch submit + result summary |

---

## Task 1: `applyPlaceholders` helper

**Files:**
- Create: `src/lib/compose.ts`

- [ ] **Step 1: Create the helper**

Create `src/lib/compose.ts` with EXACTLY:

```typescript
export interface PlaceholderContact {
  businessName: string;
  contactName?: string | null;
}

/**
 * Replaces {{businessName}} and {{contactName}} tokens with the contact's
 * values. Internal whitespace inside the braces is tolerated
 * (e.g. "{{ contactName }}"). contactName falls back to "there" when the
 * contact has no name. Any other {{...}} token is left untouched.
 *
 * Used for manual multi-contact compose personalization. Applied to both
 * subject and body by the caller.
 */
export function applyPlaceholders(text: string, contact: PlaceholderContact): string {
  const name =
    contact.contactName && contact.contactName.trim()
      ? contact.contactName.trim()
      : "there";

  return text.replace(
    /\{\{\s*(businessName|contactName)\s*\}\}/g,
    (_match, token: string) =>
      token === "businessName" ? contact.businessName : name
  );
}
```

- [ ] **Step 2: Verify behavior with a scratch node script**

The helper is plain-logic; verify its exact behavior by running this scratch check (it inlines the identical regex/fallback so no TS compilation is needed):

```bash
node -e '
function applyPlaceholders(text, contact) {
  const name = contact.contactName && contact.contactName.trim() ? contact.contactName.trim() : "there";
  return text.replace(/\{\{\s*(businessName|contactName)\s*\}\}/g, (_m, t) => t === "businessName" ? contact.businessName : name);
}
const assert = require("assert");
// both tokens
assert.strictEqual(applyPlaceholders("Hi {{contactName}} at {{businessName}}", {businessName:"Acme", contactName:"Jo"}), "Hi Jo at Acme");
// missing contactName -> "there"
assert.strictEqual(applyPlaceholders("Hi {{contactName}}", {businessName:"Acme"}), "Hi there");
// empty contactName -> "there"
assert.strictEqual(applyPlaceholders("Hi {{contactName}}", {businessName:"Acme", contactName:"  "}), "Hi there");
// internal whitespace tolerated
assert.strictEqual(applyPlaceholders("{{ businessName }}", {businessName:"Acme"}), "Acme");
// unknown token left intact
assert.strictEqual(applyPlaceholders("{{firstName}}", {businessName:"Acme"}), "{{firstName}}");
// no tokens
assert.strictEqual(applyPlaceholders("plain text", {businessName:"Acme"}), "plain text");
// global replace (multiple of same token)
assert.strictEqual(applyPlaceholders("{{businessName}} {{businessName}}", {businessName:"Acme"}), "Acme Acme");
console.log("ALL PASS");
'
```

Expected output: `ALL PASS`

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/compose.ts
git commit -m "feat: applyPlaceholders helper for compose personalization"
```

---

## Task 2: `POST /api/email-logs/batch`

**Files:**
- Create: `src/app/api/email-logs/batch/route.ts`

Context: `Contact.findById(id).lean()` returns a doc with `businessName`, `contactName`, `contactEmail`, `campaignId`, `currentStage`, `status`. `EmailLog.create({...})` accepts `contactId, campaignId, stage, subject, body, status`. `handleError` from `@/lib/api` maps errors to HTTP codes. `applyPlaceholders` was created in Task 1.

- [ ] **Step 1: Create the route**

Create `src/app/api/email-logs/batch/route.ts` with EXACTLY:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { applyPlaceholders } from "@/lib/compose";

export const dynamic = "force-dynamic";

interface SkippedItem {
  businessName: string;
  reason: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { contactIds, subject, body: emailBody } = body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return NextResponse.json(
        { error: "contactIds must be a non-empty array" },
        { status: 400 }
      );
    }
    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const subjectTemplate = (subject as string).trim();
    const bodyTemplate = (emailBody as string).trim();

    let created = 0;
    const skipped: SkippedItem[] = [];

    for (const id of contactIds) {
      try {
        const contact = await Contact.findById(id as string).lean();
        if (!contact) {
          skipped.push({ businessName: String(id), reason: "contact not found" });
          continue;
        }

        if (contact.status !== "active") {
          skipped.push({
            businessName: contact.businessName,
            reason: `contact is ${contact.status}`,
          });
          continue;
        }

        const stage = contact.currentStage + 1;
        if (stage > 3) {
          skipped.push({
            businessName: contact.businessName,
            reason: "sequence already complete",
          });
          continue;
        }

        const existing = await EmailLog.findOne({
          contactId: contact._id,
          stage,
          status: { $in: ["approved", "sent"] },
        }).lean();
        if (existing) {
          skipped.push({
            businessName: contact.businessName,
            reason: `already has a stage ${stage} email`,
          });
          continue;
        }

        const placeholderContact = {
          businessName: contact.businessName,
          contactName: contact.contactName,
        };

        await EmailLog.create({
          contactId: contact._id,
          campaignId: contact.campaignId,
          stage,
          subject: applyPlaceholders(subjectTemplate, placeholderContact),
          body: applyPlaceholders(bodyTemplate, placeholderContact),
          status: "approved",
        });

        created++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ businessName: String(id), reason: msg });
      }
    }

    return NextResponse.json({ created, skipped });
  } catch (err) {
    return handleError(err);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/email-logs/batch/route.ts
git commit -m "feat: POST /api/email-logs/batch — multi-contact approved log creation"
```

---

## Task 3: Rewrite `/compose` page

**Files:**
- Rewrite: `src/app/compose/page.tsx`

This fully replaces the single-contact compose page with a multi-contact version. Context: `@/components/ui` exports `Button` (props: `variant`, `type`, `disabled`, `style`, `onClick`, children), `MonoLabel` (props: `style`, children), `Panel` (props: `style`, children). `GET /api/campaigns` returns `{_id, name}[]` (or an error object — guard with `Array.isArray`). `GET /api/contacts?campaignId=<id>&status=active` returns contact docs `{_id, businessName, contactEmail, contactName?, currentStage}` (guard with `Array.isArray`).

- [ ] **Step 1: Replace the file**

Replace the ENTIRE contents of `src/app/compose/page.tsx` with EXACTLY:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, Panel } from "@/components/ui";

const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

const INK    = "#1A1712";
const FAINT  = "#8E836C";
const FAINT2 = "#9A8F76";
const CLAY   = "#BC5228";
const FOREST = "#1C4B3A";

interface CampaignItem {
  _id: string;
  name: string;
}

interface ContactItem {
  _id: string;
  businessName: string;
  contactEmail: string;
  contactName?: string;
  currentStage: number;
}

interface BatchResult {
  created: number;
  skipped: { businessName: string; reason: string }[];
}

export default function ComposePage() {
  const router = useRouter();

  const [campaigns,   setCampaigns]   = useState<CampaignItem[]>([]);
  const [campaignId,  setCampaignId]  = useState("");
  const [contacts,    setContacts]    = useState<ContactItem[]>([]);
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set());
  const [subject,     setSubject]     = useState("");
  const [body,        setBody]        = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [apiError,    setApiError]    = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result,      setResult]      = useState<BatchResult | null>(null);

  // Load campaigns once
  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setCampaigns(data as CampaignItem[]);
      })
      .catch(() => {});
  }, []);

  function handleCampaignChange(id: string) {
    setCampaignId(id);
    setCheckedIds(new Set());
    setContacts([]);
    setResult(null);
    setFieldErrors({});
    setApiError(null);
    if (!id) return;

    fetch(`/api/contacts?campaignId=${id}&status=active`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const sorted = (data as ContactItem[]).sort((a, b) =>
            a.businessName.localeCompare(b.businessName)
          );
          setContacts(sorted);
        }
      })
      .catch(() => {});
  }

  function toggleContact(id: string, on: boolean) {
    const next = new Set(checkedIds);
    if (on) next.add(id);
    else next.delete(id);
    setCheckedIds(next);
  }

  const allChecked = contacts.length > 0 && checkedIds.size === contacts.length;

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(contacts.map((c) => c._id)));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!campaignId)          errs.campaign = "Select a campaign";
    if (checkedIds.size === 0) errs.recipients = "Select at least one recipient";
    if (!subject.trim())      errs.subject = "Subject is required";
    if (!body.trim())         errs.body = "Body is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setApiError(null);
    setResult(null);

    try {
      const res = await fetch("/api/email-logs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: Array.from(checkedIds),
          subject: subject.trim(),
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as BatchResult;
      setResult(data);
      // Clear the form so it can't be accidentally re-sent; keep campaign + result.
      setCheckedIds(new Set());
      setSubject("");
      setBody("");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    color: FAINT,
    textTransform: "uppercase",
    letterSpacing: "0.10em",
    display: "block",
    marginBottom: 8,
  };

  const fieldErrorStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    color: CLAY,
    marginTop: 4,
    display: "block",
  };

  const noteStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    color: FAINT2,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginTop: 6,
    display: "block",
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px", minHeight: "100%" }}>

      {/* Header */}
      <MonoLabel style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 10 }}>
        MANUAL COMPOSE
      </MonoLabel>
      <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.01em", lineHeight: 1.1, margin: "0 0 28px" }}>
        Compose
      </h1>

      <div style={{ maxWidth: 620 }}>
        <form onSubmit={handleSubmit}>
          <Panel style={{ padding: 28 }}>

            {/* Campaign */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Campaign</label>
              <select
                value={campaignId}
                onChange={(e) => handleCampaignChange(e.target.value)}
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  color: campaignId ? INK : FAINT,
                  backgroundColor: "#F8F5EC",
                  border: `1px solid ${fieldErrors.campaign ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">Select a campaign…</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
              {fieldErrors.campaign && <span style={fieldErrorStyle}>{fieldErrors.campaign}</span>}
            </div>

            {/* Recipients */}
            {campaignId && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>
                    Recipients · {checkedIds.size} selected
                  </label>
                  {contacts.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: FOREST,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {allChecked ? "Clear" : "Select all"}
                    </button>
                  )}
                </div>

                {contacts.length === 0 ? (
                  <div style={{
                    fontFamily: mono, fontSize: 10.5, color: FAINT2,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    padding: "14px 0",
                  }}>
                    NO ACTIVE CONTACTS IN THIS CAMPAIGN
                  </div>
                ) : (
                  <div style={{
                    border: `1px solid ${fieldErrors.recipients ? CLAY : "#C9BEA6"}`,
                    borderRadius: 6,
                    maxHeight: 220,
                    overflowY: "auto",
                    backgroundColor: "#F8F5EC",
                  }}>
                    {contacts.map((c, idx) => (
                      <label
                        key={c._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          borderTop: idx > 0 ? "1px solid #E4DBC8" : "none",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(c._id)}
                          onChange={(e) => toggleContact(c._id, e.target.checked)}
                          style={{ width: 15, height: 15, accentColor: FOREST, flexShrink: 0, cursor: "pointer" }}
                        />
                        <span style={{ fontFamily: grotesk, fontSize: 14.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.businessName}
                          <span style={{ color: FAINT2 }}> ({c.contactEmail})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                {fieldErrors.recipients && <span style={fieldErrorStyle}>{fieldErrors.recipients}</span>}
                <span style={noteStyle}>STAGE AUTO-ASSIGNED PER CONTACT (NEXT TOUCH)</span>
              </div>
            )}

            {/* Subject */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject…"
                style={{
                  fontFamily: serif,
                  fontSize: 22,
                  fontWeight: 400,
                  color: INK,
                  letterSpacing: "-0.01em",
                  backgroundColor: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${fieldErrors.subject ? CLAY : "#C9BEA6"}`,
                  outline: "none",
                  width: "100%",
                  padding: "3px 0",
                  lineHeight: 1.3,
                }}
              />
              {fieldErrors.subject && <span style={fieldErrorStyle}>{fieldErrors.subject}</span>}
            </div>

            {/* Body */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your email…"
                style={{
                  fontFamily: grotesk,
                  fontSize: 16.5,
                  lineHeight: 1.75,
                  color: "#2A251C",
                  backgroundColor: "transparent",
                  border: `1px solid ${fieldErrors.body ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  outline: "none",
                  width: "100%",
                  minHeight: 260,
                  padding: "14px 18px",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              {fieldErrors.body && <span style={fieldErrorStyle}>{fieldErrors.body}</span>}
              <span style={noteStyle}>{"TOKENS: {{businessName}} · {{contactName}}"}</span>
            </div>

            <Button
              type="submit"
              variant="primary"
              style={{ width: "100%", marginTop: 18 }}
              disabled={submitting || checkedIds.size === 0}
            >
              {submitting
                ? "Queuing…"
                : `Queue ${checkedIds.size} email${checkedIds.size === 1 ? "" : "s"} for send`}
            </Button>

          </Panel>
        </form>

        {/* API error */}
        {apiError && (
          <Panel style={{ padding: "16px 22px", marginTop: 16 }}>
            <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>
              {apiError}
            </MonoLabel>
          </Panel>
        )}

        {/* Result summary */}
        {result && (
          <Panel style={{ padding: "20px 22px", marginTop: 16 }}>
            <MonoLabel style={{ fontSize: 12, letterSpacing: "0.10em", color: FOREST, display: "block" }}>
              QUEUED {result.created}
              {result.skipped.length > 0 && (
                <span style={{ color: CLAY }}> · SKIPPED {result.skipped.length}</span>
              )}
            </MonoLabel>

            {result.skipped.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {result.skipped.map((s, i) => (
                  <div key={i} style={{ fontFamily: mono, fontSize: 11, color: CLAY, marginTop: 4 }}>
                    {s.businessName} — {s.reason}
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              style={{ marginTop: 18 }}
              onClick={() => router.push("/review")}
            >
              Go to Review Queue
            </Button>
          </Panel>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/compose/page.tsx
git commit -m "feat: multi-contact compose — campaign-filtered recipient checklist"
```

---

## Post-Implementation Smoke Test

After all 3 tasks are committed:

```bash
npm run build
```

Expected: build succeeds; new route `/api/email-logs/batch` appears in the route list (30 routes total). No TypeScript errors.

Then manual test:

1. Ensure a campaign exists with at least 2 active fresh contacts (currentStage 0) and, ideally, one contact that already has a stage-1 approved/sent log.
2. Go to `/compose`, select the campaign — the recipient checklist populates.
3. Click "Select all" — count shows all recipients selected.
4. Write a subject/body using `{{businessName}}` and `{{contactName}}`.
5. Click "Queue N emails for send".
6. Confirm the result panel shows `QUEUED <n>` and, if applicable, a `SKIPPED` line naming the already-emailed contact with reason "already has a stage 1 email".
7. Click "Go to Review Queue" → confirm the new approved logs appear with names substituted into subject/body.
8. Send them via the Review Queue send button as usual.
```

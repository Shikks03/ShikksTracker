# Manual Compose + Send Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users write emails manually (bypassing AI) and send approved batches via a UI button, making the tool fully operable with no Anthropic API key or external cron.

**Architecture:** Extract the per-log send logic from `sequence.ts` into a shared `sendOneLog` helper, add a `POST /api/email-logs` endpoint that creates an `approved` log directly, add `POST /api/send-batch` that calls `sendOneLog` in a loop, wire up a `/compose` page, add a Compose nav item, and enhance the Review Queue approved strip with checkboxes + a Send button.

**Tech Stack:** Next.js App Router, TypeScript, MongoDB/Mongoose, Gmail API via `src/lib/gmail.ts`, existing `src/lib/sequence.ts` helpers.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/sequence.ts` | Export `sendOneLog` + `SendOneLogResult`; refactor `sendApproved` to call it |
| Modify | `src/app/api/email-logs/route.ts` | Add `POST` handler (manual compose → approved log) |
| Create | `src/app/api/send-batch/route.ts` | UI-triggered batch send |
| Create | `src/app/compose/page.tsx` | Manual compose form |
| Modify | `src/components/Sidebar.tsx` | Add `06 · Compose` nav item |
| Modify | `src/app/review/page.tsx` | Approved strip: checkboxes + Send button + results |

---

## Task 1: Extract `sendOneLog` from `sequence.ts`

**Files:**
- Modify: `src/lib/sequence.ts`

This task pulls the per-log send logic out of `sendApproved` into an exported `sendOneLog` function. `sendApproved` then calls `sendOneLog` in its loop. No external behaviour changes — this is a pure refactor verified by the TypeScript compiler.

- [ ] **Step 1: Add `SendOneLogResult` interface and `sendOneLog` function**

Open `src/lib/sequence.ts`. Add the following block directly **above** the `// Phase C: sendApproved` comment (around line 233):

```typescript
// ---------------------------------------------------------------------------
// Exported: send a single approved EmailLog
// ---------------------------------------------------------------------------

export interface SendOneLogResult {
  status: "sent" | "skipped" | "failed";
  contactName: string;
  subject: string;
  error?: string;
}

/**
 * Sends one approved EmailLog. Handles threading, tracking, Gmail send,
 * post-send EmailLog/Contact updates. Called by both the sequence engine
 * and the manual send-batch API.
 *
 * Reverts the log to "draft" if the contact is inactive or the campaign
 * is missing, so it doesn't linger in the approved queue.
 */
export async function sendOneLog(log: IEmailLog): Promise<SendOneLogResult> {
  try {
    // Load contact
    const contact = await Contact.findById(log.contactId).lean() as IContact | null;
    if (!contact || contact.status !== "active") {
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft" });
      return {
        status: "skipped",
        contactName: contact?.businessName ?? "unknown",
        subject: log.subject,
        error: "contact not active — reverted to draft",
      };
    }

    // Load campaign (needed for sequenceSpacingDays)
    const campaign = await Campaign.findById(log.campaignId).lean() as ICampaign | null;
    if (!campaign) {
      await EmailLog.findByIdAndUpdate(log._id, { status: "draft" });
      return {
        status: "skipped",
        contactName: contact.businessName,
        subject: log.subject,
        error: "campaign not found — reverted to draft",
      };
    }

    // Threading for stages 2–3
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;
    let subjectToSend = log.subject;

    if (log.stage > 1) {
      const prevLog = await EmailLog.findOne({
        contactId: contact._id,
        stage: { $lt: log.stage },
        status: "sent",
      })
        .sort({ stage: -1 })
        .lean();

      if (prevLog) {
        if (prevLog.gmailThreadId) threadId = prevLog.gmailThreadId;
        if (prevLog.rfcMessageId) inReplyTo = prevLog.rfcMessageId;

        let stage1RfcMessageId: string | null | undefined;
        if (log.stage === 3) {
          const stage1Log = await EmailLog.findOne({
            contactId: contact._id,
            stage: 1,
            status: "sent",
          }).lean();
          stage1RfcMessageId = stage1Log?.rfcMessageId;
        }
        const refParts = [stage1RfcMessageId, prevLog.rfcMessageId];
        const uniqueRefs = [...new Set(refParts.filter(Boolean))];
        if (uniqueRefs.length) references = uniqueRefs.join(" ");

        subjectToSend = prevLog.subject.startsWith("Re:")
          ? prevLog.subject
          : `Re: ${prevLog.subject}`;

        log.subject = subjectToSend;
        await EmailLog.findByIdAndUpdate(log._id, { subject: subjectToSend });
      }
    }

    // Tracking IDs (not persisted until post-send update so failed sends retry cleanly)
    const trackingPixelId = randomUUID();
    const { links } = extractAndRewriteLinks(log.body);
    const htmlBody = renderTrackedHtml(log.body, links, trackingPixelId);

    // Send
    const { messageId, threadId: returnedThreadId } = await sendGmailMessage({
      to: contact.contactEmail,
      subject: subjectToSend,
      htmlBody,
      threadId,
      inReplyTo,
      references,
    });

    const sentAt = new Date();
    const rfcMessageId = await fetchRfcMessageId(messageId);

    // Update EmailLog
    await EmailLog.findByIdAndUpdate(log._id, {
      status: "sent",
      sentAt,
      gmailMessageId: messageId,
      gmailThreadId: returnedThreadId,
      rfcMessageId,
      trackingPixelId,
      links,
    });

    // Update Contact
    const contactUpdate: Record<string, unknown> = {
      currentStage: log.stage,
    };
    if (log.stage === 1 && contact.pipelineStage === "not_started") {
      contactUpdate.pipelineStage = "contacted";
    }

    let firstSentAt: Date;
    if (log.stage === 1) {
      firstSentAt = sentAt;
    } else {
      const stage1Log = await EmailLog.findOne({
        contactId: contact._id,
        stage: 1,
        status: "sent",
      })
        .select({ sentAt: 1 })
        .lean();
      firstSentAt = stage1Log?.sentAt ?? sentAt;
    }

    if (log.stage < 3) {
      contactUpdate.nextSendAt = computeNextSendAt(
        firstSentAt,
        campaign.sequenceSpacingDays,
        (log.stage + 1) as 2 | 3
      );
    } else {
      contactUpdate.nextSendAt = null;
    }

    await Contact.findByIdAndUpdate(contact._id, contactUpdate);

    return { status: "sent", contactName: contact.businessName, subject: subjectToSend };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "failed", contactName: "unknown", subject: log.subject, error: msg };
  }
}
```

- [ ] **Step 2: Replace the body of `sendApproved` with a call to `sendOneLog`**

Replace the entire `sendApproved` function (lines 240–428 in the original file) with:

```typescript
async function sendApproved(runStartMs: number): Promise<SendsResult> {
  const result: SendsResult = { sent: 0, skipped: [], errors: [] };
  const now = new Date();

  if (!isWithinSendWindow(now)) {
    result.skipped.push("outside send window");
    return result;
  }

  const dayStart = getManilaDayStart(now);
  const sentToday = await EmailLog.countDocuments({
    status: "sent",
    sentAt: { $gte: dayStart },
  });
  const remaining = DAILY_SEND_CAP - sentToday;
  if (remaining <= 0) {
    result.skipped.push("daily cap reached");
    return result;
  }

  const batchLimit = Math.min(remaining, SENDS_PER_RUN);

  const approvedLogs = await EmailLog.find({ status: "approved" })
    .sort({ _id: 1 })
    .limit(batchLimit);

  for (let i = 0; i < approvedLogs.length; i++) {
    const log = approvedLogs[i];

    if (Date.now() - runStartMs > RUN_TIME_BUDGET_MS) {
      result.skipped.push(`time budget exceeded — ${approvedLogs.length - i} log(s) deferred`);
      break;
    }

    const logResult = await sendOneLog(log);
    if (logResult.status === "sent") {
      result.sent++;
    } else if (logResult.status === "skipped") {
      result.skipped.push(`log ${String(log._id)}: ${logResult.error ?? "skipped"}`);
    } else {
      result.errors.push(`log ${String(log._id)}: ${logResult.error ?? "failed"}`);
    }

    if (i < approvedLogs.length - 1) {
      await sleep(randomDelayMs(SEND_DELAY_MIN_MS, SEND_DELAY_MAX_MS));
    }
  }

  return result;
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors. If there are errors, they will be in sequence.ts — fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sequence.ts
git commit -m "refactor: extract sendOneLog helper from sequence engine"
```

---

## Task 2: Add POST to `/api/email-logs/route.ts`

**Files:**
- Modify: `src/app/api/email-logs/route.ts`

- [ ] **Step 1: Add Contact import and POST handler**

Replace the entire contents of `src/app/api/email-logs/route.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const contactId = searchParams.get("contactId");
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");

    if (contactId) filter.contactId = contactId;
    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;

    const logs = await EmailLog.find(filter).lean();
    return NextResponse.json(logs);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { contactId, stage, subject, body: emailBody } = body;

    if (!contactId || typeof contactId !== "string") {
      return NextResponse.json({ error: "contactId is required" }, { status: 400 });
    }
    if (stage !== 1 && stage !== 2 && stage !== 3) {
      return NextResponse.json({ error: "stage must be 1, 2, or 3" }, { status: 400 });
    }
    if (!subject || typeof subject !== "string" || !subject.trim()) {
      return NextResponse.json({ error: "subject is required" }, { status: 400 });
    }
    if (!emailBody || typeof emailBody !== "string" || !emailBody.trim()) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }

    const contact = await Contact.findById(contactId).lean();
    if (!contact) {
      return NextResponse.json({ error: `Contact not found: ${contactId}` }, { status: 404 });
    }

    const existing = await EmailLog.findOne({
      contactId: contact._id,
      stage,
      status: { $in: ["approved", "sent"] },
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: `An approved or sent log already exists for this contact at stage ${stage as number}` },
        { status: 409 }
      );
    }

    const log = await EmailLog.create({
      contactId: contact._id,
      campaignId: contact.campaignId,
      stage,
      subject: (subject as string).trim(),
      body: (emailBody as string).trim(),
      status: "approved",
    });

    return NextResponse.json(log, { status: 201 });
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
git add src/app/api/email-logs/route.ts
git commit -m "feat: POST /api/email-logs — manual compose creates approved log"
```

---

## Task 3: Create `POST /api/send-batch/route.ts`

**Files:**
- Create: `src/app/api/send-batch/route.ts`

- [ ] **Step 1: Create the file**

Create `src/app/api/send-batch/route.ts` with this content:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";
import { getManilaDayStart, sendOneLog } from "@/lib/sequence";

export const dynamic = "force-dynamic";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DAILY_SEND_CAP = envInt("DAILY_SEND_CAP", 15);

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const { ids } = body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids must be a non-empty array" },
        { status: 400 }
      );
    }

    // Daily cap check
    const now = new Date();
    const dayStart = getManilaDayStart(now);
    const sentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
    });
    const capRemaining = DAILY_SEND_CAP - sentToday;

    if (capRemaining <= 0) {
      return NextResponse.json(
        { error: "Daily cap reached", cap: DAILY_SEND_CAP },
        { status: 429 }
      );
    }

    // Load only approved logs, capped at remaining daily allowance
    const logs = await EmailLog.find({
      _id: { $in: ids },
      status: "approved",
    }).limit(capRemaining);

    const results: {
      id: string;
      contactName: string;
      subject: string;
      status: "sent" | "failed" | "skipped";
      error?: string;
    }[] = [];

    for (const log of logs) {
      const logResult = await sendOneLog(log);
      results.push({
        id: String(log._id),
        contactName: logResult.contactName,
        subject: logResult.subject,
        status: logResult.status,
        ...(logResult.error ? { error: logResult.error } : {}),
      });
    }

    const newSentToday = await EmailLog.countDocuments({
      status: "sent",
      sentAt: { $gte: dayStart },
    });

    return NextResponse.json({
      results,
      capRemaining: Math.max(0, DAILY_SEND_CAP - newSentToday),
    });
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
git add src/app/api/send-batch/route.ts
git commit -m "feat: POST /api/send-batch — UI-triggered manual send"
```

---

## Task 4: Create `/compose/page.tsx`

**Files:**
- Create: `src/app/compose/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/compose/page.tsx` with this content:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, Panel } from "@/components/ui";

const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

const INK   = "#1A1712";
const FAINT = "#8E836C";
const CLAY  = "#BC5228";
const FOREST = "#1C4B3A";

interface ContactItem {
  _id: string;
  businessName: string;
  contactEmail: string;
  currentStage: number;
}

export default function ComposePage() {
  const router = useRouter();

  const [contacts, setContacts]       = useState<ContactItem[]>([]);
  const [contactId, setContactId]     = useState("");
  const [stage, setStage]             = useState<1 | 2 | 3 | null>(null);
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [apiError, setApiError]       = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/contacts?status=active")
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
  }, []);

  function handleContactChange(id: string) {
    setContactId(id);
    const c = contacts.find((c) => c._id === id);
    if (c) {
      setStage((Math.min(c.currentStage + 1, 3)) as 1 | 2 | 3);
    } else {
      setStage(null);
    }
    setFieldErrors({});
    setApiError(null);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!contactId)       errs.contact = "Select a contact";
    if (!stage)           errs.stage   = "Select a stage";
    if (!subject.trim())  errs.subject = "Subject is required";
    if (!body.trim())     errs.body    = "Body is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const res = await fetch("/api/email-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          stage,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      router.push("/review");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
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

            {/* Contact */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Contact</label>
              <select
                value={contactId}
                onChange={(e) => handleContactChange(e.target.value)}
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  color: contactId ? INK : FAINT,
                  backgroundColor: "#F8F5EC",
                  border: `1px solid ${fieldErrors.contact ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">Select a contact…</option>
                {contacts.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.businessName} ({c.contactEmail})
                  </option>
                ))}
              </select>
              {fieldErrors.contact && <span style={fieldErrorStyle}>{fieldErrors.contact}</span>}
            </div>

            {/* Stage */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Stage</label>
              <div style={{ display: "flex", gap: 10 }}>
                {([1, 2, 3] as const).map((s) => {
                  const active = stage === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStage(s)}
                      style={{
                        fontFamily: mono,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        padding: "8px 18px",
                        borderRadius: 6,
                        border: `1px solid ${active ? FOREST : "#C9BEA6"}`,
                        backgroundColor: active ? FOREST : "transparent",
                        color: active ? "#F4EEDF" : FAINT,
                        cursor: "pointer",
                        transition: "all 130ms ease",
                      }}
                    >
                      {s === 1 ? "1ST" : s === 2 ? "2ND" : "3RD"}
                    </button>
                  );
                })}
              </div>
              {fieldErrors.stage && <span style={fieldErrorStyle}>{fieldErrors.stage}</span>}
            </div>

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
            <div style={{ marginBottom: 28 }}>
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
            </div>

            <Button
              type="submit"
              variant="primary"
              style={{ width: "100%" }}
              disabled={submitting}
            >
              {submitting ? "Queuing…" : "Queue for send"}
            </Button>

          </Panel>
        </form>

        {apiError && (
          <Panel style={{ padding: "16px 22px", marginTop: 16 }}>
            <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>
              {apiError}
            </MonoLabel>
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
git commit -m "feat: /compose page — manual email compose form"
```

---

## Task 5: Add `06 · Compose` to `Sidebar.tsx`

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add the Compose nav item**

In `src/components/Sidebar.tsx`, find the `NAV_ITEMS` array (lines 8–13):

```typescript
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "04", label: "Import",       href: "/import",      showBadge: false },
  { index: "05", label: "Suppressions", href: "/suppressions",showBadge: false },
];
```

Replace it with:

```typescript
const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "04", label: "Import",       href: "/import",      showBadge: false },
  { index: "05", label: "Suppressions", href: "/suppressions",showBadge: false },
  { index: "06", label: "Compose",      href: "/compose",     showBadge: false },
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: add Compose nav item to sidebar"
```

---

## Task 6: Enhance Review Queue approved strip

**Files:**
- Modify: `src/app/review/page.tsx`

Add `checkedIds` state, checkboxes on each approved row, and a Send button with a results panel. Changes are confined to the approved strip section (bottom third of the file).

- [ ] **Step 1: Add send-related state**

In `src/app/review/page.tsx`, find the existing state declarations block (around lines 95–99):

```typescript
  const [globalError, setGlobalError] = useState<string | null>(null);
```

Add three new state variables directly after it:

```typescript
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Send batch state ──────────────────────────────────────────────────────────
  const [checkedIds,   setCheckedIds]   = useState<Set<string>>(new Set());
  const [sending,      setSending]      = useState(false);
  const [sendResults,  setSendResults]  = useState<
    { id: string; contactName: string; subject: string; status: "sent" | "failed" | "skipped"; error?: string }[]
  >([]);
```

- [ ] **Step 2: Reset checked state when approved list refreshes**

Find the `loadAll` callback. After the line:

```typescript
    setApproved(approvedRes.data ?? []);
```

Add:

```typescript
    setApproved(approvedRes.data ?? []);
    // Default all newly loaded approved logs to checked
    setCheckedIds(new Set((approvedRes.data ?? []).map((l) => l._id)));
```

- [ ] **Step 3: Add `handleSendBatch` function**

Find the `handleUnapprove` function. Directly after it (before the keyboard shortcuts block), add:

```typescript
  async function handleSendBatch() {
    if (checkedIds.size === 0) return;
    setSending(true);
    setSendResults([]);
    setGlobalError(null);

    try {
      const res = await fetch("/api/send-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(checkedIds) }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setGlobalError(`Daily send cap reached (${(data as { cap?: number }).cap ?? 15}/day).`);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setGlobalError((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }

      const data = await res.json() as {
        results: { id: string; contactName: string; subject: string; status: "sent" | "failed" | "skipped"; error?: string }[];
      };
      setSendResults(data.results);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      await loadAll();
    }
  }
```

- [ ] **Step 4: Replace the approved strip JSX**

Find the section that begins with the comment `{/* ── 3. APPROVED · QUEUED STRIP ── */}` (around line 789). Replace the entire block through the closing `)}` with:

```typescript
      {/* ── 3. APPROVED · QUEUED STRIP ── */}
      {(approved.length > 0 || sendResults.length > 0) && (
        <div style={{ marginTop: 28 }}>
          <SectionHeader
            title="APPROVED · QUEUED FOR SEND"
            count={approved.length}
          />

          {/* Send results panel */}
          {sendResults.length > 0 && (
            <Panel style={{ padding: "16px 22px", marginTop: 14, overflow: "hidden" }}>
              {sendResults.map((r, i) => (
                <div key={r.id}>
                  {i > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8", margin: "8px 0" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: mono, fontSize: 13, color: r.status === "sent" ? FOREST : CLAY, flexShrink: 0 }}>
                      {r.status === "sent" ? "✓" : "✗"}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 11, color: "#5A5344", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.contactName.toUpperCase()} · {r.subject}
                    </span>
                    {r.error && (
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: CLAY, flexShrink: 0 }}>
                        {r.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {approved.length > 0 && (
            <>
              <Panel style={{ padding: 0, overflow: "hidden", marginTop: 14 }}>
                {approved.map((log, idx) => {
                  const contact = contactMap[log.contactId] ?? null;
                  const checked = checkedIds.has(log._id);
                  return (
                    <div key={log._id}>
                      {idx > 0 && (
                        <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "14px 22px",
                        }}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(checkedIds);
                            if (e.target.checked) next.add(log._id);
                            else next.delete(log._id);
                            setCheckedIds(next);
                          }}
                          style={{ marginRight: 14, cursor: "pointer", flexShrink: 0, width: 15, height: 15, accentColor: FOREST }}
                        />

                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 11,
                            color: "#5A5344",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginRight: 16,
                          }}
                        >
                          {(contact?.businessName ?? "—").toUpperCase()}
                          {" · "}
                          {ordinalStage(log.stage)} TOUCH
                          {" · "}
                          <span style={{ color: FAINT2 }}>{log.subject}</span>
                        </span>
                        <UnapproveButton onUnapprove={() => handleUnapprove(log._id)} />
                      </div>
                    </div>
                  );
                })}
              </Panel>

              {/* Send button */}
              {checkedIds.size > 0 && (
                <div style={{ marginTop: 14 }}>
                  <Button
                    variant="primary"
                    style={{ width: "100%" }}
                    disabled={sending}
                    onClick={handleSendBatch}
                  >
                    {sending
                      ? "Sending…"
                      : `Send ${checkedIds.size} email${checkedIds.size === 1 ? "" : "s"}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. The `mono` and `FOREST` constants are already defined at the top of the file.

- [ ] **Step 6: Commit**

```bash
git add src/app/review/page.tsx
git commit -m "feat: review queue approved strip — checkboxes + send batch button"
```

---

## Post-Implementation Smoke Test

After all 6 tasks are committed, do a full production build to catch any missed type errors:

```bash
npm run build
```

Expected: build succeeds, same route count as before (27 routes + 2 new = 29), no TypeScript errors.

Then manually test the full flow:

1. Navigate to `/compose`
2. Select a contact, pick stage 1, type a subject and body, click "Queue for send"
3. Confirm redirect to `/review` — the email appears in the Approved strip with its checkbox checked
4. Click "Send 1 email"
5. Confirm the row disappears from the strip; the results panel shows ✓ with the contact name and subject
6. Check the target inbox — email received
7. Confirm `engagementScore` stays 0 (no tracking events yet), `currentStage` advanced to 1, `pipelineStage` is "contacted"

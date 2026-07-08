# CLAUDE.md — Email Outreach Automation

Single-user, self-hosted cold-email outreach tool for Philippine small businesses: contact management with suppression checking, AI-drafted personalized emails (Claude API), a 3-touch Gmail sequence with a human review gate, open/click/reply tracking, engagement-based lead scoring, a sales pipeline, and an immediate human-takeover alert on reply.

**`SPEC.md` is the authoritative spec.** This file is the working summary plus decisions made after the spec was written. `SESSION_NOTES.md` tracks phase progress — build one phase per session, commit after each, and update SESSION_NOTES.md when a phase completes.

## Tech Stack

- **Framework:** Next.js (App Router, TypeScript) — UI + API routes in one project
- **Database:** MongoDB Atlas via Mongoose
- **Email:** Gmail API (`googleapis`), OAuth2 with a stored refresh token (`GOOGLE_REFRESH_TOKEN`) — no user-facing login
- **AI:** Anthropic API (`@anthropic-ai/sdk`)
- **CSV parsing:** `papaparse`
- **Deployment:** Vercel (Hobby). Cron is an **external pinger** (cron-job.org or a GitHub Actions schedule) hitting the `CRON_SECRET`-protected endpoint hourly during the send window — Vercel Hobby crons are daily-only, so do not rely on `vercel.json` crons for the sequence engine.

## Decisions (resolved from SPEC.md §18)

| Question | Decision |
|---|---|
| Sequence spacing | Day 0 / 5 / 9 (`sequenceSpacingDays: [0, 5, 9]`) |
| Daily send cap | 15/day while warming up (configurable) |
| Hot-lead threshold | `engagementScore >= 5` |
| Takeover alert channel | Email-to-self via Gmail API (ntfy/Telegram is a later upgrade) |
| Review-before-send | **Yes** — drafts require approval before sending (see Review Gate below) |
| Suppression match on import | Skip and report in the import summary; never insert |
| Cron trigger | External hourly pinger, 8am–6pm Asia/Manila only |

## Data Models (detail in SPEC.md §3)

- **Contact** — `businessName`, `contactEmail`, `contactName?`, `keyPoints` (personalization notes), `importMethod: "csv" | "manual"`, `leadSource: "cold_email" | "referral" | "event_connection" | "other"`, `campaignId`, `status: "active" | "paused" | "replied" | "bounced" | "unsubscribed"`, `currentStage: 0–3` (0 = not started, 3 = follow-up 2 sent), `pipelineStage: "not_started" | "contacted" | "replied" | "call_booked" | "proposal_sent" | "won" | "lost"`, `engagementScore`, `nextSendAt`, `createdAt`
- **Campaign** — `name`, `offerSummary` (feeds AI prompt), `toneNotes`, `sequenceSpacingDays: [0, 5, 9]`, `createdAt`
- **EmailLog** — `contactId`, `campaignId`, `stage: 1–3`, `subject`, `body`, `gmailThreadId`, `gmailMessageId`, `sentAt`, `trackingPixelId`, `openCount`/`firstOpenedAt`, `links: [{ url, trackingId }]`, `clickCount`/`firstClickedAt`, `replied`/`repliedAt`
  - **Amendment for the review gate:** add `status: "draft" | "approved" | "sent"`. `sentAt`, Gmail IDs, and tracking fields are populated only at send time.
  - **Amendment (phase 6):** also has `rfcMessageId` — the RFC-2822 `Message-ID` header fetched after send (NOT the Gmail API id); required for `In-Reply-To`/`References` threading of follow-ups.
- **Suppression** — `email` (indexed, lowercase-normalized), `reason: "unsubscribed" | "bounced" | "manual"`, `addedAt`

## Review Gate (amendment to SPEC.md §5–6)

The sequence engine is split into two steps instead of generate-and-send in one pass:

1. **Draft generation (cron):** for due contacts (`status: "active"`, `nextSendAt <= now`), call Claude and store the EmailLog as `status: "draft"`. Do not advance `currentStage` yet.
2. **Approval (manual):** dashboard review queue — user edits/approves drafts, flipping them to `"approved"`.
3. **Send (cron):** each run sends `"approved"` logs (respecting the daily cap, throttle, and send window), marks them `"sent"`, advances `currentStage`, sets `pipelineStage: "contacted"` on stage 1, and computes the next `nextSendAt`.

## Key Conventions

- **Cron endpoint** (`/api/cron/...`): protected by a `CRON_SECRET` header check. Each run: reply-check first, then draft generation, then approved sends.
- **Reply detection:** poll `users.threads.get` for active contacts with a `gmailThreadId`. On reply: `status: "replied"`, `pipelineStage: "replied"`, clear `nextSendAt`, `+10` score, fire the takeover alert. Opt-out keywords ("STOP", "unsubscribe") → `status: "unsubscribed"` + Suppression entry instead.
- **Takeover alert** (email-to-self) fires **last** in the reply-detection step so a failure elsewhere never skips it.
- **Threading:** build raw MIME with `In-Reply-To` / `References` headers so follow-ups stay in the original Gmail thread.
- **Throttling:** random 30–90 s delay between sends in a batch; hard cap 15 sends/day; send only 8am–6pm Asia/Manila. Excess due sends defer to the next run.
- **Tracking:** 1×1 pixel at `/api/track/open/{trackingPixelId}` (returns transparent PNG); links rewritten to `/api/track/click/{trackingId}` (302 to original). Opens are a weak signal (proxying/privacy protection); clicks and replies matter more.
- **Scoring:** additive on Contact — `+1` open, `+3` click, `+10` reply. Recalculate/bump on each event. Hot leads filter: `score >= 5`.
- **Pipeline transitions:** `not_started → contacted` (auto, first send) and `contacted → replied` (auto, reply detection); `call_booked` / `proposal_sent` / `won` / `lost` are manual from the dashboard.
- **Suppression:** check on every CSV import and manual add against lowercase-normalized email; matches are skipped and reported in the import summary. `unsubscribed`/`bounced` status changes auto-add to Suppression. Honor opt-outs immediately and permanently (PH Data Privacy Act — see SPEC.md §14).
- **AI drafts:** under ~120 words, reference the contact's `keyPoints`, non-generic, no spammy phrasing, always include a one-line opt-out note. Store subject/body before sending (audit trail).
- New contacts insert as `status: "active"`, `currentStage: 0`, `pipelineStage: "not_started"`, `nextSendAt: now`.

## Environment Variables

```
MONGODB_URI=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
ANTHROPIC_API_KEY=
APP_BASE_URL=            # tracking pixel, click redirects, alert links
CRON_SECRET=             # protects the sequence-engine endpoint

# Later, if the takeover alert is upgraded beyond email:
NTFY_TOPIC_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Optional tuning (defaults): ANTHROPIC_MODEL=claude-sonnet-4-6, DAILY_SEND_CAP=15,
# SENDS_PER_RUN=3, DRAFTS_PER_RUN=10, SEND_DELAY_MIN_MS=30000, SEND_DELAY_MAX_MS=60000,
# HOT_LEAD_THRESHOLD=5
```

## Non-Goals (v1)

No multi-user support, no A/B testing, no Gmail push notifications (polling only), no automated proposal generation.

---

# Project Overview (as built — audited 2026-07-07)

> This section replaces a separate PROJECT_OVERVIEW.md (merged here to avoid a redundant
> file). It describes what exists in the code, not aspirations. Companion audit files:
> **`GAPS.md`** (ranked weaknesses) and **`IMPLEMENTATION_PLAN.md`** (remediation tasks
> for a future session — read both before making non-trivial changes).

## Status

All 14 build phases are code-complete (2026-07-04), plus a full "Editorial Terminal" UI
redesign (07-05) and a manual compose/send feature set (07-06/07). **Not yet deployed**;
credentials (Mongo verified, Gmail OAuth verified, Anthropic key pending), Vercel deploy,
and the hourly pinger are pending user actions (SESSION_NOTES.md "Pending user actions").
There are no tests. Live end-to-end behavior (tracking, replies, drafts) is unverified.

## Versions (package.json)

Next.js 16.2.10 · React 19.2.4 · Mongoose ^9.7.3 · googleapis ^173 ·
@anthropic-ai/sdk ^0.110 · papaparse ^5.5 · Tailwind v4 (via @tailwindcss/postcss) ·
lucide-react ^1.23 · TypeScript ^5. No test runner installed.

## Directory Map

```
src/
  models/            Mongoose schemas: Contact, Campaign, EmailLog, Suppression (+ index barrel)
  lib/               All business logic (routes stay thin):
    db.ts              cached mongoose connect (global promise, cleared on failure)
    auth.ts            requireCronSecret (x-cron-secret header check)
    gmail.ts           OAuth2 client, raw RFC-2822 builder, sendGmailMessage, sleep/randomDelay
    draft.ts           Claude draft generation (forced tool use), bodyToHtml
    sequence.ts        THE ENGINE: run = checkReplies → generateDrafts → sendApproved;
                       sendOneLog (shared with manual send); Manila time helpers
    replies.ts         thread polling, opt-out detection, takeover alerts (queued, sent last)
    tracking.ts        URL tokenizer, renderTrackedHtml (pixel + click-link rewrite)
    scoring.ts         SCORE_OPEN/CLICK/REPLY consts + bumpEngagement ($inc)
    compose.ts         applyPlaceholders ({{businessName}}/{{contactName}}, fallback "there")
    contacts.ts        createContactChecked (single creation path: validate→suppress→dupe→insert)
    csv.ts             parseContactsCsv (papaparse, case-insensitive headers)
    api.ts             handleError (mongoose→HTTP mapping), notFound
  app/api/           Route handlers. UNAUTHENTICATED except cron/* and test/* (see GAPS #1):
    contacts[, /[id], /import]      CRUD + CSV/JSON import (stats=true → $lookup aggregation)
    campaigns[, /[id], /[id]/stats] CRUD + funnel/pipeline aggregations
    email-logs[, /[id], /batch]     list/create-approved; PATCH draft↔approved, sent immutable
    send-batch                      manual send of chosen approved logs (cap yes, window no)
    cron/sequence, cron/check-replies   engine entry points (CRON_SECRET)
    track/open/[pixelId], track/click/[trackingId]   public tracking
    auth/gmail[, /callback]         one-time OAuth bootstrap (dev tool, renders token)
    test/send-self, test/generate-draft  smoke tests (CRON_SECRET)
    stats/lead-sources, health
  app/               Pages (all "use client"): / dashboard, /review, /compose, /import,
                     /campaigns, /contacts/[id], /suppressions
  components/        Sidebar (dark, live draft badge), ui.tsx (design primitives),
                     StatusBadge, useNextSendCountdown
docs/                gmail-setup, cron-setup, deployment runbook, design brief,
                     superpowers/ (feature specs+plans by date)
design reference/    Editorial Terminal design handoff — visual source of truth (untracked)
SPEC.md              authoritative spec · SESSION_NOTES.md  build log/decisions
GAPS.md              ranked audit findings · IMPLEMENTATION_PLAN.md  remediation tasks
```

## Data Flow (one engine run)

External pinger → `GET/POST /api/cron/sequence` (x-cron-secret) → `runSequenceEngine()`:
1. **checkReplies** — for each active contact's latest sent thread, find first genuine
   contact message newer than our send (skips Gmail emoji reactions); opt-out keyword →
   unsubscribe + Suppression, else → replied + score +10 + queued takeover alert
   (alerts sent only after ALL state transitions).
2. **generateDrafts** — contacts with `nextSendAt <= now`, `currentStage < 3`: Claude
   drafts stage `currentStage+1` as `status:"draft"` (idempotent per contact+stage; cap
   DRAFTS_PER_RUN).
3. **sendApproved** — inside 8–18h Manila window, under 15/day Manila-day cap, max
   SENDS_PER_RUN, 30–60 s sleep between sends, 240 s run budget → `sendOneLog` per log.

`sendOneLog` (also used by `/api/send-batch`): load contact+campaign (revert log to
draft if inactive/missing) → threading headers from prior logs' `rfcMessageId` →
placeholder substitution → tracking rewrite (pixel + click links) → Gmail send →
persist sent state + rfcMessageId → advance contact stage/pipeline/nextSendAt
(spacing anchored to stage-1 `sentAt`).

## Why it's built this way (rationale worth preserving)

- **Two entry paths, one send function:** `sendOneLog` was extracted (07-06) so manual UI
  sends and cron sends share threading/tracking/state logic. Any send-behavior change
  goes there, nowhere else.
- **Tracking IDs assigned at send time, persisted only after success** — failed sends
  retry cleanly without orphaned pixel IDs.
- **rfcMessageId is fetched post-send** via `users.messages.get` because Gmail's send
  response contains only the API id, not the RFC-2822 `Message-ID` needed for
  `In-Reply-To`/`References`.
- **Placeholders substitute at send time** (case-insensitive) so `{{businessName}}`
  tokens work regardless of how a log was created (AI draft, single compose, batch).
- **Alerts queue and send last** in reply detection so alert failures can never corrupt
  contact state, and vice versa.
- **`bufferCommands: false` + cached global connect promise** in db.ts — serverless-safe
  Mongo; the cache clears on failure so a bad cold start isn't permanent.
- **Manila = fixed UTC+8, no DST** — time helpers exploit this deliberately
  (`getManilaDayStart` does raw offset math). Don't "generalize" them.
- **Claude via forced tool use** (`tool_choice: {type:"tool"}`) guarantees structured
  subject/body — no JSON-parsing of prose.

## Conventions for future sessions

- Business logic in `src/lib/`, routes thin; new mutations reuse `handleError`.
- Whitelist updatable fields in PATCH routes (`UPDATABLE_FIELDS` pattern).
- All UI styling is **inline style objects + hex literals** (Editorial Terminal
  convention) with shared primitives from `src/components/ui.tsx` — no CSS modules, only
  `globals.css` + Tailwind utility classes where ui.tsx already uses them. Fonts via CSS
  vars `--font-instrument-serif/--font-familjen/--font-jetbrains`.
- Development workflow (user preference): delegate implementation to Sonnet subagents,
  coordinator reviews per task; commit per phase/feature; skip credential-gated
  verification steps and record them in SESSION_NOTES instead.
- Verify with `npx tsc --noEmit` + `npm run build` (no test suite yet — creating one is
  IMPLEMENTATION_PLAN Task 2.1).

## Known constraints & gotchas

- **Nothing but cron/test routes has auth.** Do not deploy publicly before
  IMPLEMENTATION_PLAN Phase 1. This is the #1 audit finding.
- **`maxDuration = 300`** on cron routes assumes the Vercel plan honors it; CLAUDE.md
  says Hobby — unresolved contradiction (GAPS open question Q1/Q5). The engine sleeps
  30–60 s between sends *inside* the function.
- `/api/send-batch` enforces the daily cap but **intentionally not** the send window
  (user-initiated sends are allowed anytime); it currently has no inter-send throttle.
- The Review Gate statement above ("drafts require approval") is now partially
  superseded: `/compose` and `POST /api/email-logs` create logs **directly as
  `approved`** — the gate applies to AI-generated drafts, manual composes are
  self-approved by authorship.
- The "auto-add to Suppression on unsubscribed/bounced status change" convention is
  **implemented only in the reply-detection path**; manual PATCHes bypass it, and bounce
  detection doesn't exist at all (GAPS #4–#6; deployment.md overstates both).
- Opt-out matching includes bare `\bstop\b` — known false-positive hazard (GAPS #3).
- Send state is not atomic across Gmail send + DB update — duplicate-send window exists
  (GAPS #2). Fix planned before real-volume sending.
- `EmailLog` has **no timestamps**; ordering relies on `_id`.
- Frontend duplicates design tokens and an `apiFetch` helper per page, and hardcodes
  `HOT_THRESHOLD = 5` in three pages (backend reads `HOT_LEAD_THRESHOLD` env) — keep in
  sync manually until IMPLEMENTATION_PLAN Task 5.1 consolidates.
- Docs drift: README scoring numbers and "regenerate drafts" are wrong; treat code as
  truth, SPEC.md for intent, SESSION_NOTES.md for the change narrative.
- Local-workspace dirs (`tools/`, `graphify-out/`, `.planning/`, `design reference/`)
  are gitignored as of 2026-07-08. Note: `design reference/` is the visual source of
  truth for the UI — it is deliberately local-only; remove its `.gitignore` line if the
  user decides to version it.

## Secrets & Deployment Security Checklist (manual steps — walk Shikks through these when asked)

> Added 2026-07-08 after a dedicated secrets audit (GAPS.md §1.6). **When the user asks
> "security checklist", "check my keys", or similar — open this section and walk through
> it step by step, checking off what's done.** Verified facts as of the audit (don't
> re-audit): no secrets in any of the 55 commits or the working tree; `.env.local`
> gitignored and never committed; all env reads server-side; no `NEXT_PUBLIC_` vars.

### A. Before / during deploy (in order)

1. **Google OAuth — publishing status (TIME-CRITICAL).**
   Go to console.cloud.google.com → APIs & Services → **OAuth consent screen** → check
   **Publishing status**. If it says **"Testing"**: refresh tokens for Gmail scopes
   expire **every 7 days** — sending will silently die weekly. Click **"Publish app"**
   (status becomes "In production"; the "unverified app" warning on the consent screen
   is fine — only you ever consent, proceed via "Advanced → Go to app"). Then re-run the
   local `/api/auth/gmail` flow to mint a fresh long-lived refresh token and replace
   `GOOGLE_REFRESH_TOKEN` in `.env.local` (and later Vercel). Verify with
   `POST /api/test/send-self` (x-cron-secret header).
2. **Anthropic key (when purchased).** At console.anthropic.com: create the key inside a
   **dedicated workspace** (e.g. "shikkstracker"), name the key `shikkstracker-prod`,
   and set a **monthly spend limit** on the workspace (Settings → Limits — with a $5
   credit, cap at $5). Paste into `.env.local` as `ANTHROPIC_API_KEY`; never anywhere
   else (no code, no docs, no chat). Verify: `POST /api/test/generate-draft` inline mode.
3. **Generate a strong CRON_SECRET** (if the current one is short/guessable):
   PowerShell: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})`
   Update `.env.local`, and later both Vercel and the pinger together.
4. **Vercel env vars (at deploy, docs/deployment.md §2).** For each of `MONGODB_URI`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET`
   (+ `DASHBOARD_PASSWORD` once auth lands): toggle **Sensitive** (write-only — can't be
   read back from the dashboard) and scope to **Production** only. `GOOGLE_CLIENT_ID`
   and `APP_BASE_URL` are not secret. Remember: env changes need a redeploy.
5. **Pinger secret custody.** cron-job.org: put `CRON_SECRET` in the request **header**
   (`x-cron-secret`), never in the URL. GitHub Actions alternative: store it in repo
   **Settings → Secrets**, reference as `${{ secrets.CRON_SECRET }}` — never literal in
   the workflow YAML.
6. **Atlas least privilege.** Database Access → edit the app user → replace "Read and
   write to any database" with **readWrite on the app database only**. Keep network
   access `0.0.0.0/0` (required for Vercel) — compensate with a long unique DB password
   and Atlas Alerts (Project → Alerts) left on defaults.
7. **Local hygiene.** Never `git add -A` (untracked dirs); never screenshot/paste
   `.env.local`; the OAuth callback page displays the refresh token in the browser —
   close that tab after copying, and clear it from browser history if on a shared PC.

### B. If a secret ever leaks — rotation runbook (do the affected row immediately)

| Credential | Revoke / rotate |
|---|---|
| `GOOGLE_REFRESH_TOKEN` | myaccount.google.com/permissions → remove the app's access → re-run `/api/auth/gmail` → update env + redeploy |
| `GOOGLE_CLIENT_SECRET` | Cloud Console → Credentials → the OAuth client → reset secret → update env → re-run token flow |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys → disable key → create new → update env + redeploy (spend cap limits damage meanwhile) |
| `MONGODB_URI` password | Atlas → Database Access → Edit user → new password → update env + redeploy |
| `CRON_SECRET` | New random value → update Vercel + pinger together → redeploy |
| `DASHBOARD_PASSWORD` | New value in Vercel → redeploy (sessions derived from it invalidate) |

### C. Periodic (every ~3 months, or when asked)

- Review myaccount.google.com/permissions — only this app should hold Gmail scopes.
- Rotate `CRON_SECRET` (cheap; two places to update).
- Check Anthropic console usage vs. the spend cap for anomalies.
- Re-run the history scan if worried: `git log --all -- .env.local` should stay empty.

## Where to start on a known task

- Audit findings & priorities → `GAPS.md` (ranked table at top).
- Executable to-do list with file pointers and dependencies → `IMPLEMENTATION_PLAN.md`.
- Go-live steps (credentials, deploy, pinger, warm-up) → SESSION_NOTES.md pending
  actions + `docs/deployment.md` (after correcting its drift per plan Task 5.3).

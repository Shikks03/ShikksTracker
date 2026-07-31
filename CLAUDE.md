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
  - **Amendment (2026-07-10, Task 3.1):** status enum gains `"sending"` (draft → approved → **sending** → sent), a transient claim state set atomically before the Gmail call to prevent duplicate sends. Also adds `sendAttemptedAt` (Date, set on claim), `sendErrorCount` (Number), `lastSendError` (String). A stale-`sending` sweep at the start of each engine run reverts logs stuck > 10 min to `"draft"` for human verification.
- **Suppression** — `email` (indexed, lowercase-normalized), `reason: "unsubscribed" | "bounced" | "manual"`, `addedAt`

### Multi-channel amendment (2026-07-29, feature/multi-channel-outreach)

The Maps Lead Scraper (separate Chrome extension) exports Philippine businesses with **no
emails and no contact names**, so outreach became multi-channel. **Email is the only channel
that can be safely automated** — Facebook/Instagram/phone have no ToS-safe cold-outreach
API, so for those the tool AI-drafts, reminds and logs, but **the user sends manually** and
clicks "Mark sent". This was an MVP slice: `EmailLog` is deliberately NOT renamed to
`OutreachLog`, and the email path is untouched.

- **Contact** gains `outreachChannel: "email" | "facebook" | "instagram" | "phone"`
  (default `"email"`), contact vectors `phone`/`facebook`/`instagram`/`website`, and scraper
  provenance `sourcePlaceId`/`webPresenceTier`/`claimed`. `contactEmail` is **conditionally
  required** — only when `outreachChannel === "email"`.
  **Amendment (2026-07-31):** also `recentReviewDays?: number` — the age in whole days of
  the most recent visible Google review, captured at import. Prospecting/filtering signal
  only; it must **never** reach an AI prompt (rationale in `scraperCsv.ts`). It is spread
  into `Contact.create` with an explicit `!== undefined` check, NOT the truthiness pattern
  its string siblings use, because `0` days (reviewed today) is meaningful and falsy.
- **EmailLog** gains `channel` (same enum, default `"email"`), `subject` required only for
  email, and `sentManuallyAt` (distinguishes a hand-logged send from a Gmail send).
- **Indexes:** `{contactEmail, campaignId}` and `{sourcePlaceId, campaignId}` are both
  **partial** unique (`partialFilterExpression: { <field>: { $type: "string" } }`), NOT
  sparse. A *compound* sparse index still indexes a doc that has any one key, and
  `campaignId` is always present — so `sparse` would make every email-less contact (and
  every contact lacking a placeId) collide on `null`. **See the deploy-time migration note
  in SESSION_NOTES.md — Mongoose will not rebuild these on the live DB by itself.**

**The load-bearing invariant: Gmail auto-send must never touch a non-email log.** It is
enforced in three independent places — `sendApproved`'s query (`EMAIL_CHANNEL_QUERY`), a
guard inside `sendOneLog` (because `/api/send-batch` calls it directly), and the daily-cap
counter. The cap is a *Gmail deliverability budget*, so manually-sent social/phone logs are
excluded; counting them would silently halt email sending for the rest of the Manila day.

**Legacy-log convention:** logs written before `channel` existed have no such field. Every
predicate treats a missing/null `channel` as **email** (`EMAIL_CHANNEL_QUERY` in
`sequence.ts`, `isNonEmailChannel` in `outreachLogs.ts`). Never use `channel: { $ne: "email" }`
to find social logs — it would match those legacy email logs too. Note that hydrated
Mongoose docs mask this (the schema default fills `channel` on read) but `.lean()` reads do
not, so write predicates that are correct either way.

## Review Gate (amendment to SPEC.md §5–6)

The sequence engine is split into two steps instead of generate-and-send in one pass:

1. **Draft generation (cron):** for due contacts (`status: "active"`, `nextSendAt <= now`), call Claude and store the EmailLog as `status: "draft"`. Do not advance `currentStage` yet.
2. **Approval (manual):** dashboard review queue — user edits/approves drafts, flipping them to `"approved"`.
3. **Send (cron):** each run sends `"approved"` logs (respecting the daily cap, throttle, and send window). Each send atomically claims the log (`approved → "sending"`) before touching Gmail; on success marks it `"sent"`, advances `currentStage`, sets `pipelineStage: "contacted"` on stage 1, and computes the next `nextSendAt`. Pre-send Gmail failures revert to `"approved"` (auto-retry); post-send failures revert to `"draft"` (human verifies in Gmail Sent — never auto-retry a possibly-delivered email); clear invalid-recipient errors are treated as bounces (suppress + `"bounced"`). Suppression is re-checked here and at draft generation.

## Key Conventions

- **Cron endpoint** (`/api/cron/...`): protected by a `CRON_SECRET` header check. Each run: **stale-sending sweep first** (Task 3.1), then reply-check, then draft generation, then approved sends.
- **Reply detection:** poll `users.threads.get` for active contacts with a `gmailThreadId`. A bounce pre-pass runs first (mailer-daemon/postmaster message naming the contact → suppress + `"bounced"` + alert, no reply/score). On reply: `status: "replied"`, `pipelineStage: "replied"`, clear `nextSendAt`, `+10` score, fire the takeover alert. Opt-out replies (intent-anchored match, NOT bare "stop" — see `replies.ts` asymmetry rationale) → `status: "unsubscribed"` + Suppression entry + **its own takeover alert** (so misfires are auditable). From-header matching is exact-address equality via `extractFromAddress`, not substring. **Note:** the takeover alert queue itself was built 2026-07-10 (Task 3.2) — it did not exist before, despite earlier docs claiming it did.
- **Takeover alert** (email-to-self) fires **last** in the reply-detection step so a failure elsewhere never skips it.
- **Threading:** build raw MIME with `In-Reply-To` / `References` headers so follow-ups stay in the original Gmail thread.
- **Throttling (cron):** no inter-send sleep in the cron path (Task 4.2 — Hobby-safe); hard cap 15 sends/day; send only 8am–6pm Asia/Manila; `SENDS_PER_RUN=1` default (1 send per hourly cron run). Excess due sends defer to the next run.
- **Throttling (manual send-batch, Task 4.3):** `/api/send-batch` rejects requests with more than `SEND_BATCH_MAX` (env, default 5) ids with a 400. The review page chunks larger selections into groups of 5, POSTs them sequentially, and waits a randomised 1500–4000 ms between chunks — spreading sends over wall-clock time for deliverability without a long-running server function. Results accumulate incrementally; a mid-chunk daily-cap 429 stops further chunks and keeps results already gathered. The Send button shows `Sending… batch N/M` during multi-chunk runs.
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
DASHBOARD_PASSWORD=      # required — /login password; app fails closed (503) if unset
# ALLOW_OAUTH_BOOTSTRAP=true  # temporarily enables /api/auth/gmail outside development

# Later, if the takeover alert is upgraded beyond email:
NTFY_TOPIC_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Optional tuning (defaults): ANTHROPIC_MODEL=claude-sonnet-4-6, DAILY_SEND_CAP=15,
# SENDS_PER_RUN=1 (default 1 for Hobby safety — raise only on Pro/longer-duration plan),
# DRAFTS_PER_RUN=10, HOT_LEAD_THRESHOLD=5,
# BOUNCE_POLL_DETECTION=true (set "false" to disable the
# mailer-daemon poll-time bounce scan; send-time bounce classification always runs)
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
Vercel deploy and the hourly pinger are still pending user actions (SESSION_NOTES.md
"Pending user actions"). Credentials are all in place and exercised: Mongo verified,
Gmail OAuth verified, and `ANTHROPIC_API_KEY` verified live 2026-07-30 (drafting ran for
email, phone and Facebook). There are 468 vitest unit tests over the pure lib layer.
Live end-to-end behavior verified 2026-07-30 for the **draft + manual-send** path
(scraper import → AI draft → `/outreach` → mark sent, with correct stage/pipeline/
`nextSendAt` advance). Still unverified live: Gmail **auto-send**, open/click tracking and
reply detection — these need a public `APP_BASE_URL` and the pinger, so they remain
blocked on deploy (see the tracking/replies note under Known constraints).

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
    draft.ts           Claude draft generation (forced tool use)
    env.ts             envInt (shared by sequence.ts + contacts/send-batch routes)
    client.ts          client-side apiFetch<T> + HOT_THRESHOLD (used by all pages)
    sequence.ts        THE ENGINE: run = sweepStaleSending → checkReplies → generateDrafts
                       → sendApproved; sendOneLog (atomic claim, shared with manual send);
                       isStaleSending/isInvalidRecipientError helpers; Manila time helpers
    session.ts         edge-safe HMAC session token create/verify (Web Crypto) — dashboard auth
    replies.ts         thread polling, opt-out detection, takeover alerts (queued, sent last)
    tracking.ts        URL tokenizer, renderTrackedHtml (pixel + click-link rewrite)
    scoring.ts         SCORE_OPEN/CLICK/REPLY consts + bumpEngagement ($inc)
    compose.ts         applyPlaceholders ({{businessName}}/{{contactName}}, fallback "there")
    contacts.ts        createContactChecked (validate→suppress→dupe→insert) + suppressContact
                       (shared suppress helper: Suppression upsert + status + delete pending logs)
    csv.ts             parseContactsCsv (papaparse, case-insensitive headers)
    scraperCsv.ts      Maps Scraper CSV: parseScraperCsv (strips the UTF-8 BOM the
                       extension writes — without it the first header is "﻿name"
                       and every row silently fails to match), buildScraperKeyPoints
                       (deterministic personalisation string — load-bearing, it's what
                       draft.ts opens with), deriveChannel (fb → ig → phone fallback),
                       parseRecentReviewDays (string → number|undefined; "0" is valid).
                       Truncation here is code-point-safe on purpose — real review text
                       contains emoji, and a UTF-16 slice can split a surrogate pair.
    channels.ts        pure: normalizeHandleUrl/normalizeWebsiteUrl/telHref (scraped
                       handles may be full URLs, bare domains or "@handle"), CHANNEL_META
    outreachLogs.ts    NON_EMAIL_CHANNEL_QUERY, isNonEmailChannel, checkMarkSentAllowed
    api.ts             handleError (mongoose→HTTP mapping), notFound
  app/api/           Route handlers. Session-cookie auth via src/proxy.ts middleware (2026-07-08);
                     public exceptions: track/*, cron/*, test/*, health, auth/login (GAPS #1 fixed):
    contacts[, /[id], /import]      CRUD + CSV/JSON import (stats=true → $lookup aggregation);
                                    PATCH unsubscribed/bounced auto-suppresses; DELETE cascades logs
    campaigns[, /[id], /[id]/stats] CRUD + funnel/pipeline aggregations; DELETE 409s if contacts ref it
    email-logs[, /[id], /batch]     list/create-approved; PATCH draft↔approved, sent+sending immutable
    auth/login                      POST password → HMAC session cookie (Phase 1)
    send-batch                      manual send of chosen approved logs (cap yes, window no)
    outreach-logs[, /[id]/mark-sent]    non-email board: list drafts w/ joined contact;
                                        mark-sent claims the log atomically BEFORE
                                        advancing the contact (double-click safety),
                                        then reuses advanceContactAfterSend. No Gmail.
    cron/sequence, cron/check-replies   engine entry points (CRON_SECRET)
    track/open/[pixelId], track/click/[trackingId]   public tracking
    auth/gmail[, /callback]         one-time OAuth bootstrap (dev tool; 404 outside dev unless ALLOW_OAUTH_BOOTSTRAP)
    test/send-self, test/generate-draft  smoke tests (CRON_SECRET)
    stats/lead-sources, health
  app/               Pages (all "use client"): / dashboard, /review, /outreach, /compose,
                     /import, /campaigns, /contacts/[id], /suppressions
  components/        Sidebar (dark, live draft badge), ui.tsx (design primitives),
                     tokens.ts (shared fonts+palette — single source), StatusBadge,
                     useNextSendCountdown
  proxy.ts           Next 16 middleware (was middleware.ts): session-cookie auth gate
  app/login/         password login page (Phase 1)
  lib/__tests__/     vitest unit tests for the pure lib layer (221 tests, `npm test`)
docs/                gmail-setup, cron-setup, deployment runbook, design brief,
                     superpowers/ (feature specs+plans by date)
design reference/    Editorial Terminal design handoff — visual source of truth (untracked)
SPEC.md              authoritative spec · SESSION_NOTES.md  build log/decisions
GAPS.md              ranked audit findings · IMPLEMENTATION_PLAN.md  remediation tasks
```

## Data Flow (one engine run)

External pinger → `GET/POST /api/cron/sequence` (x-cron-secret) → `runSequenceEngine()`:
0. **sweepStaleSending** (Task 3.1) — any log stuck in `"sending"` > 10 min reverts to
   `"draft"` with a human-verify note (interrupted send; never auto-retried).
1. **checkReplies** — for each active contact's latest sent thread: bounce pre-pass first
   (mailer-daemon/postmaster naming the contact → suppress + `"bounced"` + alert), then
   find first genuine contact message newer than our send (exact From-address match via
   `extractFromAddress`; skips Gmail emoji reactions); opt-out (intent-anchored) →
   unsubscribe + Suppression + alert, else → replied + score +10 + alert. All alerts
   queued and sent only after ALL state transitions.
2. **generateDrafts** — contacts with `nextSendAt <= now`, `currentStage < 3`: skip if
   suppressed (unsubscribe + clear); else Claude drafts stage `currentStage+1` as
   `status:"draft"` (idempotent per contact+stage, incl. `"sending"`; cap DRAFTS_PER_RUN).
3. **sendApproved** — inside 8–18h Manila window, under 15/day Manila-day cap, max
   SENDS_PER_RUN (default 1), no inter-send sleep (Hobby-safe), 240 s run budget →
   `sendOneLog` per log.

`sendOneLog` (also used by `/api/send-batch`): **atomically claim `approved → "sending"`**
(skip if not claimed — no double-send) → load contact+campaign (revert to `"draft"` if
inactive/missing) → suppression check (suppressed → unsubscribe + delete log, never send)
→ threading headers from prior logs' `rfcMessageId` → placeholder substitution → tracking
rewrite → Gmail send → persist sent state + rfcMessageId → advance stage/pipeline/nextSendAt
(spacing anchored to stage-1 `sentAt`). Failure handling: pre-send Gmail error → `"approved"`
(retry) unless it's a clear invalid-recipient (→ bounce + suppress); post-send error →
`"draft"` (human verifies; possibly-delivered email is never auto-resent).

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
- Verify with `npm test` (vitest, unit tests over the pure lib layer in
  `src/lib/__tests__/`) + `npx tsc --noEmit` + `npm run build`.

## Known constraints & gotchas

- ~~Nothing but cron/test routes has auth~~ **RESOLVED 2026-07-08** (branch
  `security-phase-1`): app-level password auth landed — `src/proxy.ts` (Next 16 renamed
  `middleware.ts` → `proxy.ts`) guards all pages/APIs except `/api/track/*`,
  `/api/cron/*`, `/api/test/*`, `/api/health`, `/login`, `/api/auth/login`, static.
  Session = 30-day HMAC cookie (`src/lib/session.ts`, edge-safe Web Crypto) keyed by
  `DASHBOARD_PASSWORD`; fails closed with 503 if the var is unset — **local dev now
  requires `DASHBOARD_PASSWORD` in `.env.local` too.** Task 1.3 hardening also landed
  (regex escape, campaign/suppression input validation, timing-safe cron compare,
  health 503 redaction, OAuth bootstrap 404 outside dev unless `ALLOW_OAUTH_BOOTSTRAP`).
- **`maxDuration = 300`** on cron routes is a harmless ceiling request. Deploy target
  is Hobby, which may cap it to 60 s — that is now fine (Task 4.2 resolved Q1/Q5):
  `SENDS_PER_RUN=1` default with no inter-send sleep in the cron path keeps a single
  run well within 60 s.
- `/api/send-batch` enforces the daily cap but **intentionally not** the send window
  (user-initiated sends are allowed anytime). It is capped at `SEND_BATCH_MAX` (default 5)
  logs per request (Task 4.3); the review UI chunks larger selections and spaces the
  chunks with a short client-side delay, so there is no long in-function sleep.
- **Observability (Task 4.1):** each engine run writes a `CronRun` doc (30-day TTL);
  the dashboard shows a last-run strip with a PINGER-STALE warning, and the engine emails
  a self-digest on errors (throttled to one per Manila day). `GET /api/cron-runs` powers
  the strip (auth-protected).
- The Review Gate statement above ("drafts require approval") is now partially
  superseded: `/compose` and `POST /api/email-logs` create logs **directly as
  `approved`** — the gate applies to AI-generated drafts, manual composes are
  self-approved by authorship.
- ~~Suppression/bounce/opt-out/atomicity gaps~~ **RESOLVED 2026-07-10** (plan Phases 2–3):
  suppression is now checked at send AND draft time; manual unsubscribed/bounced PATCHes
  auto-add via `suppressContact` (`src/lib/contacts.ts`); bounce detection exists
  (send-time classifier + mailer-daemon poll scan, `BOUNCE_POLL_DETECTION` env-gated);
  opt-out matching is intent-anchored (bare "stop" mid-sentence = normal reply — see the
  asymmetry rationale in `replies.ts`); sends are idempotent via an atomic
  approved→"sending" claim, post-send failures revert to draft for human review, and a
  stale-"sending" sweep runs at the start of each engine run. NOTE: the takeover alert
  documented since phase 12 **never actually existed in code** until 2026-07-10 — it now
  does (reply + opt-out + bounce alerts, queued, sent last, dashboard links).
- `EmailLog` now has a `createdAt` timestamp (Task 5.2, `{ timestamps: { createdAt:
  true, updatedAt: false } }`); docs created before 2026-07-11 simply lack it, so still
  fall back to `_id` order for those.
- ~~Frontend token/apiFetch/HOT_THRESHOLD/envInt duplication~~ **RESOLVED 2026-07-11**
  (Task 5.1): design tokens live in `src/components/tokens.ts`, the client `apiFetch<T>`
  + `HOT_THRESHOLD` in `src/lib/client.ts`, `envInt` in `src/lib/env.ts` — all pages/
  routes import these. The two forest greens are named distinctly (`FOREST_ACTION`
  #1C4B3A button vs `FOREST_WON` #1C6E3A pipeline). UI hot threshold reads
  `NEXT_PUBLIC_HOT_LEAD_THRESHOLD` — keep it in sync with the server `HOT_LEAD_THRESHOLD`.
- Docs drift: mostly reconciled through 2026-07-11 (README scoring is +1/+3/+10,
  "regenerate" removed, `/compose` listed). Treat code as truth, SPEC.md for intent,
  SESSION_NOTES.md for the change narrative.
- **Multi-channel (verified live 2026-07-30):** ~~not run against a live DB~~ **the whole
  scraper→import→draft→mark-sent path is now verified end to end against the real Atlas
  cluster**, and channel-specific AI drafting has run for real. **The index migration is
  DONE** (`contactEmail_1_campaignId_1` is partial-unique on the live DB; a real 20-row
  import inserted 14/14 email-less contacts). Do not re-run `migrate:indexes:apply`
  routinely — it is idempotent but `syncIndexes()` drops anything not in the schema.
  Note the live database is named **`test`** (the URI has no db in its path, so the driver
  default applies to both the script and `src/lib/db.ts`).
  Three real-data bugs were found and fixed in `8dff223` — see the 2026-07-30 (later)
  SESSION_NOTES entry. **Still open by design:** `deriveChannel` ignores `website`, so a
  lead with a live site but no phone/socials cannot be imported at all; phone/DM drafts
  contain literal `[Your Name]`/`[Your Company]` (no sender identity feeds those prompts);
  the locality heuristic can emit fragments like "Brgy-based Cafe".
  ~~**Upstream, unfixed:** the scraper's `recent_review` column captures the relative-date
  timestamp, not the review text.~~ **RESOLVED UPSTREAM 2026-07-31.** The scraper now emits
  **31 columns**, adding `recent_review_text` (the prose of an already-visible review) and
  `recent_review_days` (that age in whole days); `recent_review` is unchanged and still
  holds the relative date. ShikksTracker consumes both (`84a0314`) and prefers the real
  prose. **`isRelativeDateOnly` stays** — legacy 29-column exports must keep working, and
  `getField` returns `""` for an absent header so they parse unchanged. Expect roughly half
  of rows to have **no** review text: the scraper performs no extra clicks by design, so a
  blank is normal and must never be treated as an error.
  **Import is insert-only.** `createContactChecked` returns `duplicate` and changes nothing
  — there is no update or upsert path, so re-importing an updated CSV refreshes NOTHING.
  Dedupe is `sourcePlaceId`+`campaignId` (preferred) else case-insensitive
  `businessName`+`campaignId`, and is **per campaign**. Of the 31 columns, 9 become real
  Contact fields, 7 are baked into the `keyPoints` prose only (so rating and review_count
  are NOT queryable), `tag` is parsed and never consumed, and 14 are never read.
  Manual replies on social/phone have no detection — the user moves the pipeline stage by
  hand; the Gmail reply/alert engine stays email-only. Known future work: `EmailLog` is
  misnamed now that it carries social/phone logs (a rename to `OutreachLog` was
  deliberately deferred out of the MVP slice).
- Local-workspace dirs (`tools/`, `graphify-out/`, `.planning/`, `design reference/`)
  are gitignored as of 2026-07-08. Note: `design reference/` is the visual source of
  truth for the UI — it is deliberately local-only; remove its `.gitignore` line if the
  user decides to version it.

## Secrets & Deployment Security Checklist (manual steps — walk Shikks through these when asked)

> Added 2026-07-08 after a dedicated secrets audit (GAPS.md §1.6). **When the user asks
> "security checklist", "check my keys", or similar — open this section and walk through
> it step by step, checking off what's done.** Verified facts as of the audit (don't
> re-audit): no secrets in any of the 55 commits or the working tree; `.env.local`
> gitignored and never committed; all env reads server-side. The lone `NEXT_PUBLIC_`
> var is `NEXT_PUBLIC_HOT_LEAD_THRESHOLD` (added 2026-07-11, Task 5.1) — a non-secret
> integer that mirrors the server `HOT_LEAD_THRESHOLD` for UI highlighting; no secret is
> ever exposed to the client.

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

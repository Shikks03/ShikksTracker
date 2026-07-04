# SESSION_NOTES.md — Build Progress

**Current phase:** ALL 14 PHASES CODE-COMPLETE (2026-07-04). Remaining work is user-side go-live: see "Pending user actions" below and `docs/deployment.md`.

## Pending user actions (in order)

1. MongoDB Atlas cluster → put `MONGODB_URI` in `.env.local`, verify `/api/health` says `connected`.
2. Google Cloud OAuth setup per `docs/gmail-setup.md` → run `/api/auth/gmail` flow → `GOOGLE_REFRESH_TOKEN` → test POST `/api/test/send-self`.
3. `ANTHROPIC_API_KEY` in `.env.local` → test POST `/api/test/generate-draft` (inline mode).
4. Deploy to Vercel + set env vars (`docs/deployment.md`).
5. Hourly pinger on cron-job.org or GitHub Actions per `docs/cron-setup.md`.
6. Small warm-up batch (3–5 contacts incl. yourself) before importing a real list.

Build one phase per session, in order (SPEC.md §17). Commit after each phase. When a phase completes, check it off, fill in its Notes line, and move the "Current phase" pointer.

## Decisions Locked (2026-07-04 interview)

- Deploy: Vercel Hobby; sequence engine triggered by an external hourly pinger (cron-job.org or GitHub Actions), 8am–6pm Asia/Manila
- Review gate: **yes** — drafts require dashboard approval before sending (EmailLog gains `status: draft/approved/sent`)
- Takeover alert: email-to-self via Gmail API
- Sequence spacing: day 0 / 5 / 9 · Daily cap: 15 · Hot-lead threshold: score ≥ 5
- Suppression matches on import: skip + report (never insert)

## Phases

- [x] **1. Project setup** — Next.js (TS) app, MongoDB connection, env config, hello-world deploy to Vercel to confirm hosting end to end.
  - Notes: Done 2026-07-04 (commits c8e1da6, b7939a6). Next.js 16 / TS / Tailwind / src dir; cached mongoose helper `src/lib/db.ts` (retries after failed connect); `/api/health` returns db connected/unconfigured/error; `.env.example` committed. **Pending user action:** Vercel deploy + real MONGODB_URI in `.env.local`.
- [x] **2. Data models** — Contact, Campaign, EmailLog (incl. draft/approved/sent status), Suppression + basic CRUD API routes.
  - Notes: Done 2026-07-04 (commits 9c5b427, 6ad8b42). Four models in `src/models/` with exact spec enums/defaults + indexes (unique email+campaign dedupe, status+nextSendAt for sequence engine, sparse tracking indexes). CRUD routes for contacts/campaigns/email-logs/suppressions; shared error mapper in `src/lib/api.ts` (400 validation/cast, 409 duplicate). Not yet run against a real DB (no MONGODB_URI).
- [x] **3. Contact import** — CSV upload + manual entry form, suppression checking (skip + report), lead source tagging, dedupe.
  - Notes: Done 2026-07-04. Shared `createContactChecked` in `src/lib/contacts.ts` (invalid → suppressed → duplicate → insert with nextSendAt=now); papaparse CSV parsing in `src/lib/csv.ts` (case-insensitive headers, leadSource default cold_email); `/api/contacts/import` (multipart or JSON) returns inserted/suppressed/duplicates/invalid summary; manual POST /api/contacts routed through same check (422 suppressed / 409 dup); basic `/import` page. Runtime test pending real DB.
- [x] **4. Gmail OAuth + manual send test** — one-time local auth flow, store refresh token, send one test email to self. *(code complete; live test pending user creds)*
  - Notes: Done 2026-07-04 (code only). `src/lib/gmail.ts`: OAuth2 client from refresh token, raw RFC-2822 builder (UTF-8 subject encoding, In-Reply-To/References threading), `sendGmailMessage`, throttle utils. OAuth bootstrap at `/api/auth/gmail` (+ callback page that displays refresh token). Test-send at POST `/api/test/send-self` (x-cron-secret guarded; `requireCronSecret` in `src/lib/auth.ts`). **Pending user action:** follow `docs/gmail-setup.md` (GCP project, OAuth client, run token flow), then run the test send.
- [x] **5. AI personalization** — Claude API call producing a draft from sample key points; test standalone before wiring to sending. *(code complete; live generation pending ANTHROPIC_API_KEY)*
  - Notes: Done 2026-07-04 (commit 2e2d5f5). `src/lib/draft.ts`: `generateEmailDraft` via forced tool use (`email_draft` tool, guaranteed structured subject/body), stage-aware system prompt (<120 words, keyPoints-specific opener, opt-out line, follow-up continuity via previousEmails), model env-tunable (default claude-sonnet-4-6); `bodyToHtml` escape+paragraph helper. Test endpoint POST `/api/test/generate-draft` (inline mode works without DB).
- [x] **6. Sequence engine + review gate** — cron endpoint (CRON_SECRET): reply-check → draft generation for due contacts → send approved drafts; stage advancement, daily cap, send window. Includes the draft review/approve queue (API + basic UI). Test with a fake contact and minutes-scale spacing.
  - Notes: Done 2026-07-04 (commits + fix 9b9bf64). `src/lib/sequence.ts`: run = checkReplies stub (Phase 9 slot) → generateDrafts (idempotent per contact+stage, cap counts created only) → sendApproved (Manila 8–18 window, 15/day cap, 3/run, 30–60s throttle, 240s time budget; stale approved logs revert to draft). Threading via rfcMessageId (new EmailLog field; fetched post-send), Re: subject override, References oldest-first. Cron at GET/POST `/api/cron/sequence` (x-cron-secret, maxDuration 300). Review gate: PATCH/DELETE `/api/email-logs/[id]` (draft↔approved only, sent immutable) + `/review` queue UI. `docs/cron-setup.md` for pinger setup. End-to-end run test pending creds.
- [x] **7. Open tracking pixel** — endpoint + pixel embed, confirm a hit logs.
  - Notes: Done 2026-07-04 (with phase 8). `/api/track/open/[pixelId]` always returns 1x1 PNG (no-store, never 404s), $inc openCount + firstOpenedAt + engagement +1. Pixel injected at send in sequence engine; ids persisted only in the post-send update so failed sends retry cleanly.
- [x] **8. Link click tracking** — link rewriting + 302 redirect endpoint, confirm a click logs.
  - Notes: Done 2026-07-04. `src/lib/tracking.ts`: plain-text URL tokenizer (trailing punctuation preserved outside anchor, dedupe per URL), `renderTrackedHtml` escapes text segments only; `/api/track/click/[trackingId]` 302s to original URL (+3 score, clickCount/firstClickedAt), unknown/error → redirect to APP_BASE_URL. `src/lib/scoring.ts`: SCORE_OPEN/CLICK/REPLY + `bumpEngagement`. Live hit test pending deploy.
- [x] **9. Reply detection + suppression handling** — thread polling, opt-out keyword handling, status transitions.
  - Notes: Done 2026-07-04. `src/lib/replies.ts`: polls threads of active contacts (From-header + internalDate > last sentAt), opt-out keywords (stop/unsubscribe/opt-out) matched only after stripping quoted text and "On … wrote:" attribution (prevents false positives from our own footer); opt-out → unsubscribed + Suppression upsert + pending drafts deleted; normal reply → status/pipeline replied, +10 score, pending drafts deleted. First step of every cron run; standalone test endpoint `/api/cron/check-replies`. Live test pending creds.
- [x] **10. Pipeline stage automation** — auto-transitions on send/reply; manual stage controls in a basic UI.
  - Notes: Done 2026-07-04. Auto not_started→contacted landed in phase 6 (first send), contacted→replied in phase 9. Manual controls (call_booked/proposal_sent/won/lost + pause/resume) on `/contacts/[id]` detail page (commit 9a8e2ec).
- [x] **11. Engagement scoring** — +1/+3/+10 scoring tied to open/click/reply events; hot-leads filter (score ≥ 5).
  - Notes: Done 2026-07-04. Scoring wired in phases 7/8/9 via `src/lib/scoring.ts`. `hot=true` filter on GET /api/contacts (HOT_LEAD_THRESHOLD env, default 5) + "Hot leads only" checkbox and score highlighting on the dashboard.
- [x] **12. Human takeover alert** — email-to-self on reply, fired last in the reply-detection pass.
  - Notes: Done 2026-07-04 (with phase 9). Alerts queue during reply processing and send only after ALL state transitions commit; each alert in its own try/catch (alert failure never affects contact state). Subject "Reply from {businessName}", link to `/contacts/{id}`. ntfy/Telegram upgrade deferred per decision.
- [x] **13. Dashboard UI** — contacts table (filters/sort), campaign funnel, lead source breakdown, contact detail timeline, suppression list view.
  - Notes: Done 2026-07-04 (commits 9a8e2ec, 39c0b41). `/` contacts table (campaign/pipeline/leadSource/status filters, hot toggle, score sort, per-contact stats via $lookup aggregation — campaignId cast fix 39c0b41), `/contacts/[id]` detail + timeline + manual controls, `/campaigns` (create form, funnel bars, pipeline breakdown, lead-source table via /api/stats/lead-sources), `/suppressions` (search/add/delete), shared NavBar/StatusBadge.
- [x] **14. Production cron + real spacing** — day 0/5/9 spacing, set up the external hourly pinger against production, small real test batch before full volume. *(code/docs complete; deploy + pinger are user actions)*
  - Notes: Done 2026-07-04 (commit b228155). Spacing was already real days (Campaign default [0,5,9]). `docs/deployment.md` go-live runbook (Atlas, Vercel env, prod OAuth redirect, smoke tests, pinger, warm-up, PH DPA reminders); README rewritten; `.env.example` gained optional-tuning section (DAILY_SEND_CAP, SENDS_PER_RUN, DRAFTS_PER_RUN, SEND_DELAY_*, HOT_LEAD_THRESHOLD, ANTHROPIC_MODEL).

## Session Log

- **2026-07-04** — Project bootstrapped: SPEC.md copied in, CLAUDE.md and SESSION_NOTES.md created, spec open questions resolved by interview (see Decisions Locked). No code yet.
- **2026-07-04** — All 14 phases implemented in one session (Sonnet implementer subagents, per-phase spec+quality review by coordinator). Notable review catches fixed along the way: failed-connection caching in db.ts, literal `To: me` header in test-send, draft-cap starvation + approved-queue head-of-line blocking in the sequence engine, campaignId ObjectId cast in the stats aggregation. Everything verified via tsc + production build (27 routes); anything needing live credentials is deferred to the user actions above.

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

- **2026-07-29** — **Multi-channel outreach (Phases 1–5) implemented** on branch
  `feature/multi-channel-outreach` (commits `d979d25`, `9e0fabe`, `ffff9d4`, `b4ce141`,
  `36629a8`). Sonnet implementer subagents, coordinator review + verification per phase.
  **Why:** the Maps Lead Scraper (separate Chrome extension at
  `C:\Users\Shikks\Projects\ClaudeProjects\scraper`) exports a 29-column CSV of Philippine
  businesses with **no email addresses and no contact names**, so its output could not feed
  an email-only tool. Decision: make ShikksTracker multi-channel rather than hunt for
  emails. Reality that shaped the design — **email is the only channel that can be safely
  automated**; Facebook/Instagram/phone have no ToS-safe cold-outreach API, so for those the
  tool AI-drafts, reminds and logs, but **the human sends manually**. Scope was an MVP
  slice: `EmailLog` was deliberately NOT renamed to `OutreachLog`, and email automation is
  untouched.
  **P1 data model:** `Contact.outreachChannel` + `phone`/`facebook`/`instagram`/`website`,
  scraper provenance (`sourcePlaceId`/`webPresenceTier`/`claimed`), conditionally-required
  `contactEmail`; `EmailLog.channel`, conditional `subject`, `sentManuallyAt`.
  **P2 scraper import:** `src/lib/scraperCsv.ts` (`parseScraperCsv` /
  `buildScraperKeyPoints` / `deriveChannel`), a non-email branch in `createContactChecked`,
  `format=scraper` + `defaultChannel` on the import route, and a third "Maps Scraper" mode
  on `/import`.
  **P3 drafting/send:** channel-specific prompts (`SOCIAL_DM_SYSTEM_PROMPT`,
  `PHONE_SCRIPT_SYSTEM_PROMPT`) using a subject-less `message_draft` tool;
  `EMAIL_CHANNEL_QUERY` restricts Gmail auto-send to email logs;
  `advanceContactAfterSend` extracted so cron and manual sends share state logic.
  **P4 board:** `GET /api/outreach-logs`, `POST /api/outreach-logs/[id]/mark-sent`
  (atomic claim before advancing, so a double-click can't double-advance the stage),
  `/outreach` page, Outreach nav item, channel fields on contact detail.
  Tests 311 → 396; tsc + production build green throughout.
  **Bugs caught in review (not by the agents that wrote the code):**
  (a) P1's `{sourcePlaceId, campaignId}` index used `sparse: true` — wrong for a *compound*
  index, since Mongo only skips a doc missing ALL keys and `campaignId` is always present,
  so the second email contact in any campaign would have hit a duplicate-key error and
  broken ordinary email imports; now a `partialFilterExpression` (`9e0fabe`).
  (b) the daily-cap counter counted every `sent` log, so marking social messages sent would
  consume the Gmail warm-up budget and silently halt email sending mid-day — now filtered in
  both `sendApproved` and `/api/send-batch`.
  (c) `sendOneLog`'s guard and `EMAIL_CHANNEL_QUERY` disagreed about legacy channel-less
  logs; verified dormant (Mongoose applies the schema default on hydration, so they read
  back as `"email"`) but made consistent, since it breaks under `.lean()`.
  Also consolidated the handle-URL normaliser + channel badges, which two agents had
  duplicated verbatim, into `src/lib/channels.ts` + `src/components/ChannelBadges.tsx`.
  **Not verified live:** no `/outreach` run against a real DB, and AI drafting for the new
  channels is unexercised — per the project's skip-credential-gated convention, covered by
  unit tests only.
  **⚠ INDEX MIGRATION (must happen before the first scraper import):** two Contact indexes
  changed shape. Mongoose only *creates missing* indexes — it never alters or drops one that
  already exists under the same name — so the live Atlas DB still carries the old
  plain-unique `{contactEmail, campaignId}`. Under it a missing field is indexed as null, so
  the FIRST email-less contact inserts fine and every later one fails E11000: a 200-row
  scraper import would land exactly one contact.
  Run **`npm run migrate:indexes`** (dry run — prints the current indexes and the planned
  diff, changes nothing), then **`npm run migrate:indexes:apply`**. The apply path verifies
  both indexes ended up partial and non-sparse, and exits non-zero if not. Dry-run is the
  default deliberately: `syncIndexes()` drops ANY index not declared in the schema.
  **Note this is not only a deploy-time step** — `.env.local` almost certainly points at the
  same Atlas cluster, so it is a prerequisite for testing locally too.

- **2026-07-30** — **Multi-channel branch reviewed + hardened.** Three follow-up commits on
  the same branch. `39221d8`: the manual compose paths never stamped `channel`, so composing
  for a scraped Facebook contact produced an email-channel log that `sendOneLog` rejected and
  silently reverted to draft — it never sent and never reached `/outreach`. Subject is now
  required only when an email recipient is involved, and the board shows approved logs too
  (compose creates them as approved; the approve gate is meaningless for a hand-sent channel).
  `b71eb47`: fixes for **7 findings from an independent Codex review** — a dashboard/contact
  crash on any contact with neither name nor email (the first scraped contact would have hit
  it; client types wrongly declared `contactEmail` required, which is why tsc never caught
  it); `suppressContact` upserting a Suppression keyed on an undefined email; mark-sent
  stranding a contact if the post-claim advance failed (now a retryable repair rather than a
  409, which also heals already-stranded contacts); `advanceContactAfterSend` regressing
  concurrent higher stages (now guarded on `currentStage: { $lt: log.stage }`) and
  mis-anchoring spacing when stage-1 history is missing (now relative); legacy channel-less
  logs vanishing from `/review` while cron still sent them; case-sensitive businessName
  dedupe; and non-email ids consuming the send-batch limit. `0ad6fdb`: the migration script
  above. Tests 396 → 445. **Every one of these was a DB-semantics or null-data bug — none
  was reachable by the test suite, which has no DB layer.** Two caveats accepted rather than
  fixed: the businessName dedupe fix is lookup-only (a concurrent double-insert can still
  race; a full fix needs a stored normalized key plus a partial index), and `/api/send-batch`
  still silently omits ids it cannot send.

- **2026-07-30 (later)** — **First live-database run of the multi-channel feature.** The
  index migration is DONE and the whole scraper→outreach path is verified end to end
  against the real Atlas cluster. Commit `8dff223`.
  **Migration applied:** `npm run migrate:indexes` dry run showed exactly two planned
  changes (DROP + CREATE `contactEmail_1_campaignId_1`); `sourcePlaceId_1_campaignId_1`
  already existed and was already partial, because Mongoose auto-creates *missing*
  indexes on startup. Nothing hand-made in Atlas was at risk — every other live index
  mapped 1:1 to a schema declaration. Applied; verification passed. **Note the DB is
  named `test`** — the URI has no database in its path, so both the script and
  `src/lib/db.ts` land on the driver default. Production will use the same one.
  **Import proof:** a real 20-row export imported **14 inserted / 0 duplicates / 6
  invalid**. Under the old plain-unique index exactly ONE would have inserted and the
  other 13 would have failed E11000 — so this is direct confirmation the migration did
  its job. The UTF-8 BOM was really present in the file and stripped correctly.
  **Walkthrough:** channel-specific AI drafting ran for the first time (4 email / 4 phone
  / 2 facebook; phone + DM drafts correctly subject-less). `/outreach` showed exactly the
  6 social drafts. Mark-sent produced exactly the right state: stage 0→1,
  not_started→contacted, `nextSendAt = sentAt + 5.000 days` (= `spacing[1]`),
  `sentManuallyAt` set, and **every Gmail field null** — Gmail untouched. Email path
  unaffected: `/review` showed exactly the 4 email drafts, dashboard rendered 20 contacts
  including nameless/email-less ones without the crash Codex had found, and the engine
  correctly refused to send at 18:30 Manila ("outside send window").
  **Three findings, all needing real data to surface (fixed in `8dff223`):**
  (a) the scraper's `recent_review` column holds the review's **relative-date timestamp**
  ("2 years ago"), not the review text — on every row. Fed to the drafter it produced a
  factually wrong, damaging cold open ("your last customer review was posted around two
  years ago"). `buildScraperKeyPoints` now omits the segment when the value is only a
  relative-date phrase; genuine prose mentioning a date is still kept. **The upstream
  scraper bug is still unfixed — it lives in the separate scraper repo
  (`panelRecentReview` grabbing the timestamp element).**
  (b) the Review Queue badge counted ALL drafts but links to the email-only `/review`
  (read 9, queue held 4); the callers now pass `channel=email` (the API already
  supported it).
  (c) `compactHandle` didn't strip `web.facebook.com`, so the hostname became the handle
  ("@WEB.FACEBOOK.COM"). Display only — the outbound link was always right.
  **Deliberately NOT fixed (design decisions, still open):** `deriveChannel` ignores
  `website`, so website-only leads are silently unimportable (a real lead with a live
  site and no phone/socials was among the 6 skipped rows); phone/DM drafts contain
  literal `[Your Name]`/`[Your Company]` because no sender identity feeds those prompts,
  so every script needs hand-editing; and the locality heuristic emits fragments like
  "Brgy-based Cafe" when a house number is mistaken for a postal code.
  **Data state:** the 14 real Amadeo cafe leads were KEPT. `keyPoints` for 13 of them was
  recomputed with the fixed builder and their 5 stale drafts deleted so they regenerate
  cleanly; AMADEO ARTISANO (used for the mark-sent test) was reset to stage 0 /
  not_started with its false "sent" log removed, since no message was ever actually sent
  to that business. Also confirmed: the unsubscribe line is appended at **send** time
  (`sequence.ts`), which is why drafts correctly lack one — not a compliance gap.
  Tests 445 → 468; tsc and build clean.

- **2026-07-31** — **Scraper review columns consumed; merged to `main` and deployed.**
  Commit `84a0314` (branch `feature/scraper-review-text`, fast-forwarded into `main` and
  pushed — production auto-deployed and was verified live).
  **Upstream first:** the 2026-07-30 finding was written up as a brief for the separate
  scraper repo, and the correct diagnosis turned out to be different from the first guess.
  `panelRecentReview` was **never buggy** — its comment says it returns the freshest visible
  review's *date* as a liveness proxy, which is exactly what it did. The real defect was a
  **naming/contract mismatch**: the column was called `recent_review`, ShikksTracker read
  that as prose, and the AI reasoned about a date. The scraper now emits **31 columns**,
  adding `recent_review_text` (prose of an already-visible review) and `recent_review_days`
  (the age in whole days, computed from a value `ageDays` already derived internally and
  threw away). `recent_review` was deliberately NOT renamed — our parser matches headers by
  name and returns `""` for a missing one, so a rename would have broken us silently.
  **This side:** `parseScraperCsv` reads both new columns; `buildScraperKeyPoints` prefers
  the real prose and falls back to the old column (still guarded by `isRelativeDateOnly`,
  which keeps legacy 29-column exports working); a trailing "…" left by Maps' own truncation
  is stripped before our 140-char cut; `recentReviewDays` is persisted on Contact for future
  prospecting filters. New `parseRecentReviewDays` is permissive-in/strict-out — empty,
  non-numeric, negative and non-finite all become `undefined`, while `0` is preserved.
  **Two subtle correctness points worth keeping:** (a) `truncateOnWordBoundary` is now
  code-point-safe — real review text contains emoji, and the old `String.slice` counted
  UTF-16 units, so it could cut a surrogate pair in half and emit U+FFFD; verified 0 broken
  characters across the real export. (b) `recentReviewDays` is spread with an explicit
  `!== undefined` check rather than the truthiness pattern its string siblings use, because
  `0` days is meaningful and falsy.
  **DELIBERATE OMISSION (do not "improve" this):** no recency phrasing derived from the age
  ever enters `keyPoints`. Maps sorts reviews by relevance, not recency, so the freshest
  *visible* review is not provably the newest — putting "last reviewed X ago" in the prompt
  would reinvite the exact false claim this whole thread of work removed.
  Verified against a real 16-row export: 7 rows now carry a genuine review quote, 14 carry a
  day count, 0 broken characters. Tests 468 → 486; tsc + build clean.
  **Data refresh:** only **5 of 14** existing scraped contacts could be refreshed — the new
  scrape covered a partly different set of businesses, so 9 aren't in it and still have
  quote-less keyPoints and no day count. They need a re-scrape plus another refresh run.
  **The importer cannot do this itself: it is insert-only and silently skips duplicates**
  (`createContactChecked` returns `duplicate` and changes nothing). A "refresh on
  re-import" mode — updating scraped provenance while leaving outreach state
  (`currentStage`/`pipelineStage`/`engagementScore`/`nextSendAt`/logs) untouched — is an
  open, unbuilt idea.
  **Column coverage audit (user question):** of 31 columns, **9** become real Contact fields
  (name, place_id, phone, facebook, instagram, website, web_presence_tier, claimed,
  recent_review_days), **7** are baked into the `keyPoints` prose only and are therefore
  unqueryable (rating, review_count, category, located_in, full_address, recent_review,
  recent_review_text), **`tag`** is parsed into `ScraperRow` and never consumed by anything,
  and **14** are never read. So you cannot currently filter or sort leads by rating or
  review count. The user has asked (2026-07-31, explicitly deferred — do not design it yet)
  for a per-business **profile** retaining most columns, **branch awareness** for multiple
  locations of one business feeding the intro framing, and **"no website" as a priority
  signal**.
  **Environment gotcha:** killing the dev server mid-write left a torn
  `.next/dev/types/validator.ts` (a `peof handler>` fragment overlapping the block above).
  `tsconfig.json` includes `.next/dev/types/**/*.ts`, so `npx tsc --noEmit` failed with
  TS1434/TS1005 inside a generated, gitignored file. `rm -rf .next` and re-run — it is never
  a source regression.

- **2026-07-04** — Project bootstrapped: SPEC.md copied in, CLAUDE.md and SESSION_NOTES.md created, spec open questions resolved by interview (see Decisions Locked). No code yet.
- **2026-07-04 (later)** — Post-build fixes: HTML-escaped CSV-derived fields in the takeover alert email (security review finding, 715544a); fixed dashboard crash `campaigns.map is not a function` when the campaigns API returns an error object instead of an array — guarded the two unchecked fetches on `/` and `/import` (c1e218d). User has started running the app locally; next session continues from the "Pending user actions" list above (DB → Gmail OAuth → Anthropic key → deploy → pinger → warm-up batch).
- **2026-07-04** — All 14 phases implemented in one session (Sonnet implementer subagents, per-phase spec+quality review by coordinator). Notable review catches fixed along the way: failed-connection caching in db.ts, literal `To: me` header in test-send, draft-cap starvation + approved-queue head-of-line blocking in the sequence engine, campaignId ObjectId cast in the stats aggregation. Everything verified via tsc + production build (27 routes); anything needing live credentials is deferred to the user actions above.
- **2026-07-05** — Full UI redesign to the "Editorial Terminal" design (option 4a in `design reference/` — that handoff README + screenshots are the visual source of truth). Same workflow: Sonnet implementer subagents, per-page review by coordinator. New: 3 Google fonts (Instrument Serif / Familjen Grotesk / JetBrains Mono), Tailwind v4 `@theme` color tokens, dark 238px `Sidebar` (replaces NavBar) with live draft badge + next-send countdown, shared primitives in `src/components/ui.tsx`, lucide-react. All six pages rebuilt (dashboard groups + priority panels, one-draft-at-a-time review queue with A/E/J keys + "approve all safe" = non-hot bulk approve, contact conversation thread + pipeline checklist, campaign funnel strips, import dropzone + result tiles persisted to localStorage, suppression flat table with confirm-gated remove). Backend additions the design required: EmailLog `replyBody`/`replySnippet` persisted by reply detection; contacts `stats=true` aggregation now returns `repliedAt`/`replySnippet`/`lastLogStage`/`lastLogStatus`. Behavior/API contracts otherwise unchanged; old status filter dropdown dropped per design. Review catches fixed: engagement sort now defaults on, import upload errors surfaced (were swallowed silently), Up Next rail bg per spec. Verified via production build; visual QA against a live DB still pending the credential setup above. Identity hardcoded as "Shikks" (greeting varies umaga/hapon/gabi by Manila time).
- **2026-07-05 (later)** — Comfortable density pass applied app-wide (spec: docs/superpowers/specs/2026-07-05-comfortable-density-redesign.md, plan: docs/superpowers/plans/2026-07-05-comfortable-density-pass.md). User verdict on the Editorial Terminal redesign was "too compact"; interview calibrated to Comfortable density (type +15–20%, roomier padding, 40px tiles), full-bleed kept, sidebar widened 238→268px, subtle panel shadows + 130–150ms hover transitions + one 200ms fade-up per page (prefers-reduced-motion respected). Mechanical old→new mapping tables in the plan; Sonnet implementer subagents per file, coordinator-reviewed diffs. Coordinator fixes on top: dashboard marginTop 22→30, import numeric paddings 3→4/12→16, search-icon input insets aligned to new padding (left 14 / paddingLeft 36), campaigns paddingRight 8→10. Verified: production build clean, lint at pre-existing baseline (25 problems, none new), all five routes 200 with page-enter on the user's live dev server. Visual QA with real data still pending credential setup.
- **2026-07-10** — **Phase 4 (reliability & observability) implemented** on branch
  `phase-4-observability` (3 commits f9b0e7c/b534052/a0854b9, merged to main; same
  workflow). **Task 4.2 decision (user, 2026-07-10):** deploy target is Vercel Hobby,
  Fluid Compute unconfirmed → the Hobby-safe design: `SENDS_PER_RUN=1` default and NO
  in-function inter-send sleep in the cron path (removed the 30–60s sleep + SEND_DELAY_*
  vars); `maxDuration=300` comment corrected (harmless ceiling, Hobby may cap to 60s).
  **Task 4.1:** new `CronRun` model (startedAt/durationMs/summary/errorCount/digestSentAt,
  30-day TTL index) written once per engine run (failure-isolated); `GET /api/cron-runs`
  (auth-protected); dashboard "last engine run" strip with sent/error counts + a
  PINGER-STALE warning (>2h old while inside the send window); email-to-self error digest
  (fires on errorCount>0 or any log with sendErrorCount≥3, throttled to 1 per Manila day
  via the digestSentAt marker); review page shows lastSendError on approved logs that
  failed a send. **Task 4.3:** `/api/send-batch` capped at `SEND_BATCH_MAX=5` per request
  (400 guard); review UI chunks the selection, sends chunks sequentially with a 1.5–4s
  randomized client-side gap, accumulates results incrementally, handles mid-batch daily-
  cap. Verified: 235 tests, tsc, production build green. GAPS #9/#10/#11 + open questions
  Q1/Q2/Q5 resolved. Remaining: plan Phases 5 (maintainability) & 6 (product).
- **2026-07-10** — **Remediation Phases 2–3 implemented** on branch
  `remediation-phases-2-3` (10 commits f283db9…300c5d7, merged to main; same
  Opus-orchestrator + Sonnet-implementer workflow, per-task diff review).
  **Phase 2:** vitest harness, 164 baseline unit tests pinning current behavior of the
  pure lib layer (sequence/replies/compose/tracking/csv/gmail/draft). **Phase 3, all
  seven tasks:** (3.1) idempotent sending — atomic approved→"sending" claim before
  Gmail, revert-to-approved on pre-send failure, revert-to-DRAFT on post-send failure
  (reviewer catch: auto-retry after a successful send would duplicate), stale-sending
  sweep at run start; EmailLog gains sending status + sendAttemptedAt/sendErrorCount/
  lastSendError. (3.2) intent-anchored opt-out matching replaces `\bstop\b` (whole-
  message equality + explicit intent phrases; Tagalog TODO deliberately excluded);
  **discovery: the phase-12 takeover alert never existed in code** — full alert queue
  built (reply/opt-out/bounce subjects, HTML-escaped, dashboard links, queued and sent
  last). (3.3) suppression enforced in sendOneLog + generateDrafts. (3.4) shared
  `suppressContact` helper in lib/contacts.ts; contacts PATCH auto-adds Suppression on
  unsubscribed/bounced. (3.5) minimal bounce detection: conservative send-time
  classifier (`isInvalidRecipientError`) + mailer-daemon/postmaster poll scan
  (`BOUNCE_POLL_DETECTION`, default on). (3.6) campaign delete 409-guards on
  referencing contacts; contact delete cascades EmailLogs. (3.7) countdown hook
  aligned to engine window (<18); From-header equality matching via
  `extractFromAddress`; stats aggregation enum whitelists; queue-time placeholder
  substitution removed (send-time is the single path). Verified: 235 unit tests, tsc,
  production build all green. Remaining plan phases: 4 (observability — needs the
  Vercel-plan answer for Task 4.2), 5 (maintainability + docs truth pass), 6 (product).
- **2026-07-08** — **Security Phase 1 (auth + API hardening) implemented** on branch
  `security-phase-1` per IMPLEMENTATION_PLAN Tasks 1.2–1.4 (Opus orchestrator/validator,
  Sonnet implementer subagents; per-task diff review). (1) App-level auth: required
  `DASHBOARD_PASSWORD` env; `src/proxy.ts` middleware (Next 16 renamed middleware.ts →
  proxy.ts) with public allowlist (track/cron/test/health/login/static), 401 JSON for
  APIs, 307 → `/login?from=` for pages, fail-closed 503 when the var is unset;
  `src/lib/session.ts` edge-safe HMAC session (30 d, constant-time verify);
  `/login` page in Editorial Terminal style (d1e82ea). (2) Hardening: suppressions-search
  regex escape; explicit field-pick + validation on campaigns/suppressions POST (incl.
  sequenceSpacingDays rules, toneNotes type guard 0172f69); timing-safe
  `requireCronSecret`; `/api/health` → `{ok:false,db:"error"}` 503 (no error leak);
  `/api/auth/gmail*` 404 outside dev unless `ALLOW_OAUTH_BOOTSTRAP=true` (df821de).
  (3) Docs: deployment.md Atlas least-privilege + Vercel Sensitive-var guidance +
  DASHBOARD_PASSWORD, gmail-setup.md local-only note, README quickstart (40fb22f).
  Verified: tsc + prod build clean; 10 live boundary checks against `next start` (auth
  redirects, public paths, cookie issue/verify/tamper). **User actions:** add
  `DASHBOARD_PASSWORD` to `.env.local` (the running dev server will 503 on every page
  until then — this is the fail-closed design, not a bug), then walk the CLAUDE.md
  secrets checklist at deploy time. GAPS #1 marked resolved; Phases 2+ of the plan
  (tests, correctness/compliance) remain.
- **2026-07-13** — **Remediation Phase 6 (product improvements) implemented** on branch
  `remediation-phase-6`, merged to `main`. Workflow: Sonnet implementer subagents (one
  per task, fresh context), Opus manager reviewing each diff + independently running the
  verification trio, atomic commit per task. All SIX tasks landed (commits
  76e7b2e/4b7e3a5/d2730ed/d80e5f6/bcf172a/42c9113): **6.5** next-action layer
  (Contact.nextActionAt/nextActionNote + sparse index; engine step D emails a
  once-per-Manila-day digest of overdue actions via a new CronRun.actionDigestSentAt
  marker; RunSummary gains actionRemindersDue/actionDigestSent; dashboard OVERDUE/DUE-TODAY
  chips; contact-detail Save/Clear inputs). **6.2** one-click unsubscribe (Contact.
  unsubscribeToken UUID; public GET /api/unsubscribe/[token] → shared suppressContact,
  neutral page, no token-validity leak; appended at send time after placeholder subst,
  excluded from click-tracking via isUnsubscribeUrl; proxy allowlist; reply-STOP kept).
  **6.1** draft regeneration (buildUserMessage exported + optional feedback/previousAttempt;
  POST /api/email-logs/[id]/regenerate, draft-only, mirrors generateDrafts context,
  ANTHROPIC_API_KEY→400; review-queue Regenerate button w/ inline feedback). **6.6** compose
  templates (Template model + validated CRUD, no raw create(body); /compose dropdown +
  save-as-template). **6.3** dashboard polish (approved-awaiting count in kicker;
  non-active status chips in IN SEQUENCE; replied contacts greyed/non-selectable in
  Compose). **6.4** import preview (client-side papaparse dry-run on /import reusing the
  server parseContactsCsv + isValidEmail — extracted pure email helpers to src/lib/email.ts,
  contacts.ts re-exports for back-compat; FormData upload + server route unchanged).
  Tests 221 → 303 (all green); tsc clean throughout. **Build caveat:** the final
  `npm run build` could not be re-confirmed green at merge time due to a transient
  fonts.gstatic.com CDN outage (next/font/google downloads fonts at build) — NOT a code
  issue: identical builds passed earlier this same session and 6.x touches no font/layout
  code. Re-run `npm run build` once network is restored to reconfirm. **The remediation
  plan (Phases 0–6) is now fully code-complete.** Remaining is user-side go-live only
  (Vercel deploy + pinger; Anthropic key is now connected) and live/visual QA.
- **2026-07-11** — **Remediation Phase 5 (maintainability) implemented** on branch
  `remediation-phase-5` (3 commits, Opus direct — the changes are mechanical dedup + docs
  where the 221-test harness + tsc + build are the regression net; visual QA still blocked
  on credentials). **Task 5.2:** `EmailLog` gains `createdAt` (`timestamps:{createdAt:true,
  updatedAt:false}`). **Task 5.4:** deleted `bodyToHtml` from draft.ts (duplicated
  `renderTrackedHtml`); the generate-draft test endpoint now calls
  `renderTrackedHtml(body,[],null)` for identical untracked HTML; folded the unique
  edge-case assertions into tracking.test.ts and removed draft.test.ts (235→221 tests,
  net of the 18 removed bodyToHtml tests + 4 added). **Task 5.1:** three shared modules —
  `src/components/tokens.ts` (fonts+palette, was per-page with FOREST drift, now
  `FOREST_ACTION` #1C4B3A vs `FOREST_WON` #1C6E3A), `src/lib/client.ts` (`apiFetch<T>` +
  `HOT_THRESHOLD` reading `NEXT_PUBLIC_HOT_LEAD_THRESHOLD`), `src/lib/env.ts` (`envInt`) —
  all pages/routes migrated; previously-swallowed `.catch(()=>{})` fetches now surface
  errors (dashboard configError strip, compose/import campaign-load errors,
  `handleApproveAllSafe` reports "approved N of M — K failed"). **Task 5.3:** README
  (/review "regenerate"→"edit/discard", added /compose), pixel route now does the atomic
  `{_id, firstOpenedAt:null}` first-open write its comment already claimed, CLAUDE.md
  gotchas/map reconciled; deployment.md §6.4/§7 were already accurate from the 2-3 sync.
  Verified: tsc, 221 tests, production build all green. **Remaining plan phase: 6
  (product improvements — independent, post-go-live OK).**
- **2026-07-06 → 07-07** — **Manual compose + UI send** built to unblock sending without the Anthropic key (specs/plans in docs/superpowers/, dated 2026-07-06 & 07-07). Subagent-driven-development workflow (Sonnet implementers, spec+quality review per task); merged to `main` fast-forward, verified tsc + `npm run build` (30 routes). Two feature sets: **(A) single manual send** — `sendOneLog` extracted from `src/lib/sequence.ts` (shared by cron + manual); `POST /api/email-logs` creates an `approved` log (supersedes "no POST by design"); `POST /api/send-batch` sends caller-specified approved logs (daily cap enforced, send-window intentionally NOT); Review Queue approved strip gained checkboxes + "Send N emails" button; sidebar `06 · Compose`. **(B) multi-contact compose** — `src/lib/compose.ts` `applyPlaceholders` ({{businessName}}/{{contactName}}, name fallback "there"); `POST /api/email-logs/batch` (per-contact auto stage = currentStage+1, skips duplicates/inactive/completed with reasons, returns {created, skipped[]}); `/compose` rewritten to a campaign-filtered recipient checklist (select-all, token hint, queued/skipped summary, no auto-redirect). Cron endpoint untouched — still works if AI key + pinger added later, but the pinger is now optional. Runtime/visual QA against live DB still pending user's credential setup. Note: pre-existing uncommitted working-tree edits to next.config.ts + src/components/ui.tsx remain unstaged (not part of this work).

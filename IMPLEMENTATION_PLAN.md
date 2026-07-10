# IMPLEMENTATION_PLAN.md — Remediation Plan from GAPS.md

Written 2026-07-07 for execution by a later Claude session (Opus/Sonnet) **without
re-auditing**. Each task cites the GAPS.md finding it resolves (e.g. "G-2.1"). Read
CLAUDE.md first; SPEC.md is the authoritative spec. Conventions: TypeScript strict,
Mongoose models in `src/models/`, business logic in `src/lib/`, thin route handlers in
`src/app/api/`, shared error mapping via `handleError` in `src/lib/api.ts`. Verify every
task with `npx tsc --noEmit` and `npm run build`; there is no test suite until Task 2
creates one.

### Sequencing rationale

Phase 0 is housekeeping that protects work already done. Phase 1 (auth) comes first
because it **gates deployment** — the app must not reach a public URL without it, and
every later fix is pointless if the Gmail relay is open. Phase 2 (test harness) comes
before the correctness fixes because Tasks 3–7 rewrite exactly the pure functions the
harness covers; fixing them blind risks regressions in threading/scheduling logic that
only manifest days later in production. Phase 3 is the correctness/compliance tier —
highest real-world harm during normal operation. Phase 4 is reliability/observability
(failures must reach the user). Phase 5 is maintainability consolidation, safe to do any
time but easiest after the API surface stops moving. Phase 6 is product polish —
independent items, do in any order, or skip until after go-live.

Dependency chain in one line:
**T0 → T1 (blocks deploy) → T2 (blocks T3–T7) → T3…T7 → T8–T10 → rest.**

---

## Phase 0 — Housekeeping (15 min)

### Task 0.1 — Commit the working-tree fixes; fix .gitignore
- Commit the Gmail emoji-reaction filter (`src/lib/replies.ts`), HotChip tooltip
  (`src/components/ui.tsx`), and `devIndicators: false` (`next.config.ts`) as 2–3 atomic
  commits (the replies.ts change is a behavioral fix and must not be lost — G-4.4, G-5).
- ~~Add to `.gitignore`~~ **DONE 2026-07-08** during the git audit: `/tools/`,
  `/graphify-out/`, `/.planning/`, `/design reference/` are now ignored (verified with
  `git check-ignore`). Remaining for this task: commit the `.gitignore` change together
  with the working-tree fixes above, plus `GAPS.md` / `IMPLEMENTATION_PLAN.md` /
  `CLAUDE.md` / `docs/design-brief.md`.

## Phase 1 — Authentication (G-1.1) — BLOCKS DEPLOYMENT — ✅ DONE 2026-07-08

> Completed on branch `security-phase-1` (commits d1e82ea, df821de, 0172f69, 40fb22f).
> Task 1.1 decision: app-level auth (default path). Note: Next.js 16 renamed
> `middleware.ts` → `proxy.ts`, so the middleware lives at `src/proxy.ts`.
> Verified: tsc + build clean; live checks — `/` → 307 `/login`, `POST /api/send-batch`
> → 401, `/api/track/open/x` → 200 PNG, cron route reaches `requireCronSecret`,
> login sets HttpOnly/Secure/Lax cookie, tampered cookie → 401, fail-closed 503 without
> `DASHBOARD_PASSWORD`. Remaining from Task 1.4: the MANUAL user-side checklist in
> CLAUDE.md (OAuth publish status, Vercel Sensitive flags, Atlas scoping, spend caps).

### Task 1.1 — Decide mechanism (needs one user answer, then proceed)
GAPS.md open question Q2: if the user is happy with platform-level protection (Vercel
Deployment Protection / Password Protection), implement **only** Task 1.3's API
hardening. Default assumption if no answer: **app-level shared-password auth**, because
tracking endpoints must stay public and platform password walls break the pixel/redirect
for recipients. (Vercel Password Protection is also a paid feature — do not assume it.)

### Task 1.2 — App-level auth (default path)
- New env var `DASHBOARD_PASSWORD` (add to `.env.example`, README, docs/deployment.md).
- `middleware.ts` at project root (Next.js middleware):
  - **Public, no auth:** `/api/track/*` (recipient-facing), `/api/health`,
    `/api/cron/*` and `/api/test/*` (already guarded by `x-cron-secret` — leave that
    mechanism untouched), `/login`, Next static assets.
  - **Everything else** (all pages + all other `/api/*`): require a signed session
    cookie; otherwise redirect pages to `/login`, return 401 JSON for `/api/*`.
  - Session: HMAC-signed value derived from `DASHBOARD_PASSWORD` + secret (use Web
    Crypto — middleware runs on edge runtime; **no Node `crypto` imports**), long expiry
    (30 d) — single user, low ceremony.
- `/login` page: single password field, POST to `/api/auth/login`, sets cookie. Style
  with existing primitives (`Panel`, `Button`, `inputClass` from `src/components/ui.tsx`;
  Editorial Terminal tokens — see CLAUDE.md UI conventions).
- Since auth is cookie-based, mutating API routes become CSRF-relevant (G-noted): set the
  cookie `SameSite=Lax` + `HttpOnly` + `Secure`; that is sufficient for this app (no
  cross-site POST needs to work).
- **Files:** new `middleware.ts`, `src/app/login/page.tsx`, `src/app/api/auth/login/route.ts`;
  touch `.env.example`, `docs/deployment.md`.

### Task 1.3 — API hardening regardless of auth choice
- Escape regex input in suppressions search: `q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`
  (`src/app/api/suppressions/route.ts:14`) (G-1.2).
- Replace `Campaign.create(body)` / `Suppression.create(body)` with explicit field
  picking + validation (G-1.3): campaigns — require non-empty `name`/`offerSummary`,
  validate `sequenceSpacingDays` is a strictly-increasing array of 3 non-negative
  numbers starting at 0 (or omit → default); suppressions — validate email with
  `isValidEmail` + `normalizeEmail` from `src/lib/contacts.ts`.
- `requireCronSecret`: use `crypto.timingSafeEqual` on length-matched buffers (G-1.5).
- `/api/health`: stop returning raw error text; return `{ ok: false, db: "error" }` with
  status 503 on failure so a monitor can alert (G-1.5). **Check first** whether the
  pinger/monitoring docs rely on the current shape (docs/cron-setup.md).
- Disable `/api/auth/gmail*` outside development (return 404 unless
  `process.env.NODE_ENV === "development"` or an explicit `ALLOW_OAUTH_BOOTSTRAP=true`),
  documenting in docs/gmail-setup.md that the flow is run locally (G-1.4).

### Task 1.4 — Secrets posture (G-1.6, G-22, G-23) — mostly manual, split ownership
Audited 2026-07-08: no secrets in git history or working tree, `.env.local` never
committed, no client-side env exposure. Remaining work splits cleanly:
- **Code side (implementer):** already covered by Task 1.3 — health-endpoint error
  redaction, timing-safe `requireCronSecret`, OAuth bootstrap routes disabled outside
  development. Nothing additional; do NOT invent extra secret-management code (no vault,
  no encryption layer — env vars on Vercel are the right tool at this scale).
- **docs side (implementer):** update `docs/deployment.md` — §1: scope the Atlas DB user
  to the app database (`readWrite@<dbname>`) instead of "any database"; §2: instruct
  marking MONGODB_URI, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, ANTHROPIC_API_KEY,
  CRON_SECRET (+ DASHBOARD_PASSWORD from Task 1.2) as **Sensitive** in Vercel and
  scoping them to Production; add a pointer to the CLAUDE.md security checklist.
- **Manual side (user):** the step-by-step checklist lives in **CLAUDE.md §"Secrets &
  Deployment Security Checklist"** — single source of truth; do not duplicate the steps
  here. The one time-critical item: verify the Google OAuth consent screen is published
  ("In production", not "Testing"), otherwise the Gmail refresh token expires every
  7 days (G-22).

## Phase 2 — Test harness (G-4.1) — BLOCKS Phase 3 — ✅ DONE 2026-07-10 (commit f283db9; 164 baseline tests, grown to 235 by end of Phase 3)

### Task 2.1 — Vitest + unit tests for the pure layer
- Add `vitest` (devDependency) + `"test": "vitest run"` script. No React testing needed;
  scope is the pure lib layer only.
- Cover, with today's behavior as the baseline (write tests BEFORE Phase 3 changes,
  then update expectations per-task):
  - `sequence.ts`: `getManilaHour`, `isWithinSendWindow` (boundary hours 7/8/17/18),
    `getManilaDayStart`, `computeNextSendAt` (incl. missing-spacing fallbacks).
  - `replies.ts`: `stripQuotedText`, `isOptOut` (incl. the false-positive cases that
    Task 3.2 will fix — mark as `todo` initially), `isGmailReaction`, `makeSnippet`
    (export the private helpers or test through a thin export barrel).
  - `compose.ts`: `applyPlaceholders` (case variants, whitespace, fallback "there",
    unknown tokens untouched).
  - `tracking.ts`: `extractAndRewriteLinks` (dedupe, trailing punctuation),
    `renderTrackedHtml` (escaping, anchor injection, pixel append, APP_BASE_URL guard —
    set/unset env in test).
  - `csv.ts`: `parseContactsCsv` (header case-insensitivity, missing fields, bad
    leadSource).
  - `gmail.ts`: `buildRawMessage` (RFC 2047 subject, threading headers, base64url).
  - `draft.ts`: `bodyToHtml` (if kept — see Task 5.4).
- **Files:** `src/lib/__tests__/*.test.ts`, `package.json`, `vitest.config.ts`.

## Phase 3 — Correctness & compliance (G-2.x) — requires Phase 2 — ✅ DONE 2026-07-10

> All seven tasks landed on branch `remediation-phases-2-3` (commits a53f59b…300c5d7,
> merged to main). Notable deviations/discoveries: (a) Next steps for 3.1 — post-send
> failures go to "draft" for human review, never auto-retry (reviewer catch); (b) 3.2 —
> the takeover alert described in SESSION_NOTES phase 12 NEVER EXISTED in code; Task 3.2
> built the full alert queue (reply + opt-out + bounce alerts, dashboard links) from
> scratch; (c) 3.2 — Tagalog opt-out patterns deliberately excluded (TODO in replies.ts);
> (d) 3.5 — poll-time bounce scan gated by BOUNCE_POLL_DETECTION (default on).
> Task 5.3's docs-truth pass should now update deployment.md §6.4/§7 to describe the
> REAL bounce + suppression-at-send behavior (both exist now).

### Task 3.1 — Make sending idempotent (G-2.1)
- In `sendOneLog` (`src/lib/sequence.ts`):
  1. Before calling Gmail, atomically claim the log:
     `findOneAndUpdate({ _id, status: "approved" }, { status: "sending", sendAttemptedAt: now })`.
     If no doc matched, another runner has it — skip. (Also fixes the cap race G-2.7's
     worst consequence: the same log can no longer be double-sent by cron + manual batch.)
  2. On Gmail success → existing post-send update path (status: "sent" …).
  3. On Gmail failure → revert to `"approved"` and increment a new `sendErrorCount` /
     set `lastSendError` (fields used by Task 4.1).
  4. Startup sweep in `runSequenceEngine`: any log stuck in `"sending"` older than
     ~10 min is ambiguous (send may or may not have gone out) — do **not** auto-retry;
     flag it via `lastSendError: "interrupted mid-send — verify in Gmail Sent folder"`
     and revert to `"draft"` so a human decides.
- Schema: add `"sending"` to the EmailLog status enum, plus `sendErrorCount`,
  `lastSendError`, `sendAttemptedAt` (`src/models/EmailLog.ts`). Audit every
  `status: { $in: [...] }` query across the codebase for whether `"sending"` belongs in
  it (`sequence.ts`, `replies.ts` pending-delete queries, `email-logs` routes, review UI
  filters).
- Update `/api/email-logs/[id]` PATCH/DELETE guards: `"sending"` is immutable like
  `"sent"`.

### Task 3.2 — Fix opt-out matching (G-2.2)
- In `src/lib/replies.ts`, replace `/\bstop\b/i` with intent-anchored patterns, e.g.:
  - whole-message (trimmed, quoted-stripped) equals `stop`/`unsubscribe`/`opt out`
    (± punctuation), OR
  - `reply stop`, `please (remove|unsubscribe|take me off)`, `remove me`,
    `not interested.*(remove|unsubscribe)`, `opt me out`, `huwag na` (PH audience —
    confirm with user before adding Tagalog patterns; note as TODO otherwise).
- Keep `\bunsubscribe\b` (rarely used innocently).
- **Ambiguity handling:** if a reply contains a weak signal (bare "stop" mid-sentence),
  treat it as a **normal reply** (alert fires, human reads it) — false-negative opt-outs
  get caught by the human takeover; false-positive opt-outs are silent and permanent.
  This asymmetry is the design rationale; preserve it in a comment.
- Also: send the takeover alert for opt-out replies too (currently skipped —
  `replies.ts` only queues normal replies), subject "Opt-out from {businessName}", so the
  user can audit misfires. Update tests.

### Task 3.3 — Enforce suppression at send time (G-2.3)
- In `sendOneLog`, after loading the contact: look up
  `Suppression.findOne({ email: contact.contactEmail })`; if present, set the contact
  `status: "unsubscribed"`, `nextSendAt: null`, delete pending draft/approved logs for
  the contact, and return `skipped` with reason. (Email is already stored normalized on
  both models — `lowercase: true` — so direct equality is safe.)
- Add the same check to draft generation (`generateDrafts`) to stop wasting Claude calls.

### Task 3.4 — Suppression auto-add on manual status change (G-2.4)
- In `PATCH /api/contacts/[id]`: when the update sets `status` to `"unsubscribed"` or
  `"bounced"`, upsert a Suppression entry (reason = the status; copy the upsert pattern
  from `replies.ts:260-265`) and clear `nextSendAt`. This closes the loop CLAUDE.md
  already claims exists.

### Task 3.5 — Bounce detection, minimal viable version (G-2.5)
- Full DSN parsing is overkill for v1. Two cheap layers:
  1. **Send-time:** in `sendOneLog`, catch Gmail API errors whose message/status
    indicate invalid recipient (400 `invalidArgument` on address, 404) → mark contact
    `bounced` + Suppression (via the Task 3.4 helper), log revert to draft with
    `lastSendError`.
  2. **Poll-time:** in `checkReplies`, when scanning thread messages, treat a message
    from `mailer-daemon@` / `postmaster@` containing the contact's address as a bounce
    → same transition. (The thread-metadata fetch already retrieves From headers.)
- If this proves noisy, gate layer 2 behind an env flag. Update deployment.md §6 to
  describe what is actually implemented (see Task 5.3).
- **Depends on:** Task 3.4's shared "suppress contact" helper — extract it into
  `src/lib/contacts.ts` (e.g. `suppressContact(contactId, reason)`) so replies.ts,
  contacts PATCH, and bounce handling share one implementation.

### Task 3.6 — Delete guards (G-2.6)
- `DELETE /api/campaigns/[id]`: refuse (409 + count) if any Contact references the
  campaign; message tells the user to delete/move contacts first. Simplest correct
  behavior for a single user; no cascade.
- `DELETE /api/contacts/[id]`: also delete that contact's EmailLogs (audit-trail note:
  acceptable, the user is deleting the relationship; mention in response payload:
  `{ deleted: true, logsDeleted: n }`).

### Task 3.7 — Window off-by-one + small fixes (G-2.7)
- `useNextSendCountdown.ts:21`: `manilaHour <= 18` → `< 18`. Add a matching unit test on
  the engine side pinning `isWithinSendWindow(18:00 Manila) === false`.
- `replies.ts:215`: parse the From header address properly (angle-bracket extract or
  regex `<(.+?)>` fallback to whole value) and compare with `===` after lowercase.
- `stats=true` aggregation path (`contacts/route.ts`): whitelist-validate `status`,
  `pipelineStage`, `leadSource` against their enums before `$match`.
- Remove queue-time placeholder substitution from `/api/email-logs/batch` (keep
  send-time substitution as the single path — it's already case-insensitive and
  documented as path-independent). Verify compose UI preview text still makes sense.

## Phase 4 — Reliability & observability (G-3.x) — ✅ DONE 2026-07-10

> Branch `phase-4-observability` (commits f9b0e7c, b534052, a0854b9). Task 4.2's open
> question answered: **Hobby target, Fluid Compute unconfirmed → SENDS_PER_RUN=1 default,
> no in-function inter-send sleep** (the safe design, option b). Task 4.1 shipped the
> CronRun model (30d TTL), `GET /api/cron-runs`, dashboard last-run strip + PINGER-STALE
> detector, Manila-day-throttled email error digest, and review-page lastSendError. Task
> 4.3 capped send-batch per request (SEND_BATCH_MAX=5) with client-side chunking/spacing.
> Verified: 235 tests, tsc, build green. Remaining plan phases: 5 (maintainability), 6 (product).

### Task 4.1 — Failure surfacing (G-3.3)
- Persist per-run summaries: new tiny `CronRun` model (startedAt, duration, summary
  JSON, error count). Write one doc per `runSequenceEngine` run; cap the collection
  (TTL index, ~30 days).
- Dashboard: small strip (or sidebar line) showing "last engine run: 2h ago · 3 sent ·
  1 error" from a new `GET /api/cron-runs?limit=1`; render error count in CLAY red. If
  the last run is >2 h old during the send window, show "PINGER STALE" warning — this is
  the cheap dead-pinger detector.
- Email-to-self error digest: in `runSequenceEngine`, if `errors.length > 0` OR any log
  has `sendErrorCount >= 3`, send one summary email via the existing
  `sendGmailMessage` (reuse takeover-alert pattern in `replies.ts:331-365`; escape
  content with `htmlEscape`). Throttle: at most one digest per Manila day (check
  CronRun docs for a digest-sent marker).
- Review page: show `lastSendError` on approved logs that have one (approved strip
  already exists; add a CLAY annotation).
- **Depends on:** Task 3.1 (fields), Task 1.x (dashboard API auth for the new route).

### Task 4.2 — Serverless timing decision (G-3.1) — needs user answer Q1/Q5
- Confirm actual Vercel plan + max duration. Then either:
  - **(a) plan supports 300 s:** keep design; lower `RUN_TIME_BUDGET_MS` comment-accuracy,
    and reduce default `SEND_DELAY_MAX_MS` so worst case (3 sends × 60 s + overhead)
    fits with margin; or
  - **(b) it doesn't:** set `SENDS_PER_RUN=1` default (pinger is hourly; 15/day cap
    still reachable across 10 window-hours + manual batches) and drop inter-send sleep
    in cron entirely. Simpler than a queue and fits the volume.
- Document the decision in CLAUDE.md Constraints.

### Task 4.3 — Throttle manual batch sends (G-11)
- `/api/send-batch` loop: add the same `sleep(randomDelayMs(...))` between sends as the
  cron path — but see 4.2; if serverless duration is tight, cap manual batch size per
  request (e.g. 3) and have the review UI chunk requests client-side with a progress
  indicator (UI already tracks per-log results).

## Phase 5 — Maintainability (G-4.x)

### Task 5.1 — Shared frontend API client + tokens (G-4.2)
- New `src/lib/client.ts` (client-safe): the `apiFetch<T>` helper (move from
  review/contacts pages), used by ALL pages; every currently-swallowed `.catch(() => {})`
  gets an error state (pattern already exists on the dashboard: `error` state + Panel).
- New `src/components/tokens.ts`: export `serif/grotesk/mono`, INK/FAINT/FAINT2/CLAY/
  AMBER/FOREST/etc. Resolve the FOREST drift (`#1C4B3A` vs `#1C6E3A`) by checking the
  design source of truth (`design reference/design_handoff_shikkstracker_redesign/README.md`)
  — the darker `#1C4B3A` is the button green, `#1C6E3A` the "won" green; name them
  distinctly (`FOREST_ACTION`, `FOREST_WON`) rather than guessing.
- `HOT_THRESHOLD`: expose from the backend — cheapest correct fix is
  `GET /api/health`-style config endpoint or embed via a server component reading env;
  pragmatic alternative: `NEXT_PUBLIC_HOT_LEAD_THRESHOLD` mirroring the server var,
  documented in `.env.example` as "keep in sync with HOT_LEAD_THRESHOLD".
- Dedupe `envInt` into `src/lib/env.ts`; import in `sequence.ts`, `contacts/route.ts`,
  `send-batch/route.ts`.
- `handleApproveAllSafe` (`review/page.tsx`): collect per-draft results, surface
  "approved N / failed M" via existing `globalError`/result patterns.
- **Note:** this task rewrites imports in every page — do it in one PR, run
  `npm run build`, and eyeball each page (pure refactor, no behavior change).

### Task 5.2 — EmailLog timestamps (G-3.4)
- Add `{ timestamps: { createdAt: true, updatedAt: false } }` to the EmailLog schema
  (matches Contact/Campaign convention). Existing docs simply lack the field — fine.
  Optionally show draft age in the review queue.

### Task 5.3 — Docs truth pass (G-4.3)
- README: scoring +1/+3/+10; remove "regenerate" (or land Task 6.1 first); add
  `/compose` to pages table.
- deployment.md: rewrite §6.4 (bounce) and §7 (suppression-at-send) to match whatever
  Tasks 3.3/3.5 actually shipped. **Do this after Phase 3, not before.**
- CLAUDE.md: update the Review Gate section to note the manual-compose path creates
  directly-approved logs (supersedes "all drafts require approval"); note suppression
  auto-add is now implemented (3.4).
- Fix the lying comment in `track/open/[pixelId]/route.ts:66-75` (either implement the
  conditional write `{ _id, firstOpenedAt: null }` filter — trivial, do that — or fix
  the comment).

### Task 5.4 — Deduplicate paragraph rendering (G-3.5)
- Delete `bodyToHtml` from `draft.ts`; the test endpoint can call
  `renderTrackedHtml(body, [], null)` which degrades to the identical untracked output
  (verify with the Phase 2 tests — the `filter`/empty-paragraph edge behaviors differ
  slightly; pin with a test first).

## Phase 6 — Product improvements (independent; post-go-live OK)

### Task 6.1 — Draft regeneration with feedback (G-5)
- Review queue: "Regenerate" button → `POST /api/email-logs/[id]/regenerate` with
  optional `feedback` string; server re-runs `generateEmailDraft` with the same inputs
  plus a `feedback` line appended to the user message ("Previous attempt was rejected
  because: …"), replaces subject/body on the draft log. Requires ANTHROPIC_API_KEY (the
  route should 400 with a clear message otherwise, same pattern as
  `test/generate-draft`).
- **Files:** `src/lib/draft.ts` (accept optional feedback + previousAttempt),
  new route, `review/page.tsx`.

### Task 6.2 — Unsubscribe link (G-5)
- New public route `GET /api/unsubscribe/[token]` (token = per-contact UUID stored on
  Contact) → suppress via the Task 3.4 helper, render a minimal "you're unsubscribed"
  page. Append the link line at send time in `sendOneLog` (after placeholder
  substitution, before tracking rewrite so the link is NOT click-tracked — exclude it in
  `extractAndRewriteLinks` by matching the own-domain unsubscribe path). Keep "reply
  STOP" too.
- This reduces reliance on the keyword matcher and is the single best deliverability
  investment available.

### Task 6.3 — Dashboard status polish (G-5)
- Show approved-awaiting-send count in the header kicker next to drafts.
- In "IN SEQUENCE" rows, render non-active `status` (paused/bounced/unsubscribed) as a
  mono chip so they're distinguishable.
- Compose: show replied contacts greyed-out with "replied — take over personally" note
  instead of omitting them silently (do NOT make them selectable unless the user asks —
  open question Q3).

### Task 6.4 — Import preview (G-5)
- `/import`: parse client-side first (papaparse is already a dependency) and show a
  dry-run table (N valid / N invalid rows with reasons) before the POST. Server behavior
  unchanged.

### Task 6.5 — Follow-up "next action" layer (user-approved 2026-07-08; highest-value Phase 6 item)
Post-reply pipeline management. Today the system automates up to the reply, then drops
the contact entirely (`checkReplies` clears `nextSendAt`, fires one alert, done) —
pipeline stages are dateless manual markers that never resurface. This adds human-touch
scheduling built from existing parts. No new dependencies; no ANTHROPIC_API_KEY needed.

1. **Model** (`src/models/Contact.ts`): add `nextActionAt: Date | null` (default null)
   and `nextActionNote: string | null`. Index `{ nextActionAt: 1 }` (sparse). Same
   pattern as `nextSendAt`.
2. **API** (`src/app/api/contacts/[id]/route.ts`): add `nextActionAt`, `nextActionNote`
   to `UPDATABLE_FIELDS`. Validate `nextActionAt` casts to a Date or null; cap note
   length (~500 chars). Clearing = set both null.
3. **Engine step D** (`src/lib/sequence.ts`): after `sendApproved`, query contacts with
   `nextActionAt <= now`, non-null. If any, send ONE email-to-self digest listing
   businessName / note / days overdue / link to `/contacts/{id}` — adapt the
   takeover-alert block in `src/lib/replies.ts:331-365` (reuse `sendGmailMessage`,
   escape all fields with `htmlEscape`, `encodeURI` the links). Throttle to at most one
   digest per Manila day (`getManilaDayStart`; if Task 4.1's CronRun model exists, store
   the marker there — otherwise a `lastActionDigestAt` field on a new tiny KV/meta doc).
   Do NOT auto-clear `nextActionAt` on digest — it clears only when the user acts.
   Extend `RunSummary` with `actionRemindersDue` / `actionDigestSent`.
4. **Dashboard** (`src/app/page.tsx`): the `stats=true` contacts payload already flows
   here; include `nextActionAt`/`nextActionNote` (plain schema fields — the aggregation
   passes them through; just add to the `ContactRow` type). In the "REPLIED — YOUR MOVE"
   group, sort overdue-first and render a CLAY mono chip `OVERDUE 3D` / AMBER `DUE TODAY`
   (reuse `timeAgo`-style helper; chip styling per `HotChip` pattern in
   `src/components/ui.tsx`).
5. **Contact detail** (`src/app/contacts/[id]/page.tsx`): "Next action" field group —
   date input + note input + Save/Clear, PATCHing via the page's existing `apiFetch`
   pattern. When the user advances a pipeline stage (existing manual controls), surface
   the next-action inputs inline as a prompt (do not block the stage change).
- **Dependencies:** none hard. Ordering: after Task 3.1 only because both edit
  `sequence.ts`/`RunSummary` (merge convenience, not logic). Digest marker is cleaner
  after Task 4.1 but must not wait on it.
- **Verify:** unit tests for the due-query date logic + digest-throttle predicate;
  `tsc`/build; manual: set a past `nextActionAt`, run cron with secret, confirm one
  digest email and no second digest on the next run same day.

### Task 6.6 — Compose templates (companion recommendation; smaller)
Saved templates for the manual-compose flow — the main effort-saver while the AI
drafting path is blocked (no ANTHROPIC_API_KEY).
- New `Template` model: `name`, `subject`, `body`, `createdAt` (body/subject may contain
  the existing `{{businessName}}`/`{{contactName}}` tokens — substitution already
  happens at send time via `applyPlaceholders`, so templates need no special handling).
- CRUD: `GET/POST /api/templates`, `DELETE /api/templates/[id]` — follow the
  suppressions route shape, with explicit field validation per Task 1.3's convention
  (no raw `create(body)`).
- `/compose`: template dropdown above Subject; selecting fills subject+body (editable
  after); "Save as template" button when subject+body are non-empty (prompt for name).
- **Dependencies:** Task 1.2 (routes must land behind auth like everything else).

---

## Verification checklist (per phase)

- `npx tsc --noEmit` and `npm run build` clean.
- `npm test` (from Phase 2 onward) green.
- Phase 1: with no cookie — `/` redirects to `/login`, `POST /api/send-batch` → 401,
  `GET /api/track/open/x` → 200 PNG, cron route with secret → 200.
- Phase 3: unit tests updated to pin new behavior (opt-out cases, window boundary,
  suppression-at-send skip reason).
- Anything requiring live Gmail/Mongo/Anthropic credentials stays a documented manual
  step (see SESSION_NOTES "Pending user actions") — per the established workflow, do not
  block on credential-gated verification.

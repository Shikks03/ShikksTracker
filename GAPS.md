# GAPS.md — Architectural & Quality Audit Findings

Audited 2026-07-07 against commit `746f9dd` (plus uncommitted working-tree edits to
`next.config.ts`, `src/components/ui.tsx`, `src/lib/replies.ts`). Full read of models,
lib layer, all API routes; sampled read of all frontend pages; docs cross-checked
against code. No changes were made to source files.

---

## Ranked Findings (most → least critical)

| # | Gap | Area |
|---|-----|------|
| 1 | ~~No authentication on dashboard or mutating API routes~~ **RESOLVED 2026-07-08** (Plan Tasks 1.2–1.4, branch `security-phase-1`) | Security |
| 2 | ~~Non-atomic send ⇒ duplicate sends~~ **RESOLVED 2026-07-10** (Task 3.1: atomic claim → "sending" state, post-send failures → draft for human review, stale sweep) | Correctness |
| 3 | ~~Opt-out keyword false positives~~ **RESOLVED 2026-07-10** (Task 3.2: intent-anchored matcher; opt-outs now also fire takeover alerts) | Correctness / Compliance |
| 4 | ~~Suppression not checked at send time~~ **RESOLVED 2026-07-10** (Task 3.3: checked in sendOneLog + generateDrafts) | Compliance |
| 5 | ~~Manual unsubscribed/bounced bypasses Suppression~~ **RESOLVED 2026-07-10** (Task 3.4: shared suppressContact helper, PATCH auto-adds) | Compliance |
| 6 | ~~Bounce detection does not exist~~ **RESOLVED 2026-07-10** (Task 3.5: send-time classifier + mailer-daemon poll scan, env-gated) | Correctness / Docs drift |
| 7 | ~~Delete orphans~~ **RESOLVED 2026-07-10** (Task 3.6: campaign delete 409-guards on contacts; contact delete cascades logs) | Data integrity |
| 8 | ~~Zero tests~~ **RESOLVED 2026-07-10** (Task 2.1: vitest, 235 unit tests over the pure lib layer) | Quality |
| 9 | ~~No observability~~ **RESOLVED 2026-07-10** (Task 4.1: CronRun log w/ 30d TTL, dashboard last-run strip + PINGER STALE detector, email error digest throttled 1/Manila-day, review-page lastSendError) | Reliability |
| 10 | ~~Serverless sleep / timeout risk~~ **RESOLVED 2026-07-10** (Task 4.2: Hobby confirmed as target; SENDS_PER_RUN=1 default, no in-function inter-send sleep) | Architecture |
| 11 | ~~send-batch has no throttle~~ **RESOLVED 2026-07-10** (Task 4.3: SEND_BATCH_MAX=5 per-request cap + review UI chunks & spaces sends client-side) | Deliverability |
| 12 | Regex injection / ReDoS in suppressions search (`$regex` from query string) | Security |
| 13 | Mass-assignment style `Model.create(body)` on campaigns & suppressions | Security / Validation |
| 14 | Unauthenticated public tracking + OAuth endpoints (DoS, score inflation, missing OAuth `state`) | Security |
| 15 | Daily-cap race between cron and manual send-batch — **mostly closed 2026-07-10** by Task 3.1's atomic claim (same log can't double-send; theoretical cap overshoot of 1–2 within a race window remains) | Correctness (minor) |
| 16 | ~~Send-window off-by-one~~ **RESOLVED 2026-07-10** (Task 3.7: countdown hook aligned to engine `< 18`) | Correctness (minor) |
| 17 | No pagination; contacts aggregation `$lookup`s all logs | Scalability |
| 18 | Frontend duplication: `apiFetch`, design tokens, `HOT_THRESHOLD`, `envInt` | Maintainability |
| 19 | Docs drift: README scoring numbers, "regenerate drafts", deployment.md bounce claims | Docs |
| 20 | Product gaps: no draft regeneration, no unsubscribe link/header, replied contacts invisible to Compose, no bulk pause, silent partial failures in "Approve all safe" | Product/UX |
| 21 | Repo hygiene: untracked binary + generated dirs, `.gitignore` gaps | Hygiene |
| 22 | Google OAuth app in "Testing" status ⇒ Gmail refresh token expires every 7 days (verify/publish) | Reliability / Secrets |
| 23 | Secrets hygiene is manual-config, not code: Vercel sensitive-var flags, key scoping, spend caps, rotation runbook | Security / Ops |

*Rows 22–23 appended 2026-07-08 from a dedicated secrets/API-key audit (§1.6) — kept at
the end to preserve existing cross-references. By severity, #22 belongs in the
reliability tier (~rank 9): if the OAuth consent screen is still in Testing status, the
refresh token verified on 2026-07-05 silently dies within a week and all sending stops.*

### Prioritization logic

This codebase is **code-complete but not yet deployed** (SESSION_NOTES: Vercel deploy and
credentials are pending user actions). That reframes severity: the classic "highest CVSS
first" ordering matters less than *what breaks the moment this goes live*. #1 is alone at
the top because deployment is the very next planned step, and on a public Vercel URL the
unauthenticated API hands any visitor the ability to send email from the owner's personal
Gmail, read every prospect's PII, and delete legally-required opt-out records. Nothing
else on the list can be safely fixed "later" if this ships first — so it gates deploy.

The second tier (#2–#7) is correctness and compliance with *real recipients*: things that
send duplicate emails, email people who opted out, or silently unsubscribe interested
leads. These are worse than typical bugs because the failure leaves the building — you
cannot roll back a sent email, and PH Data Privacy Act compliance is an explicit spec
requirement (SPEC §14). They rank above security items #12–#14 because those require an
attacker, while #2–#7 fire on their own during normal operation.

Third tier (#8–#11) is reliability: this is an unattended hourly engine run by a single
person who will not be watching logs; silent failure modes (stuck approved logs, dead
pinger, cron errors nobody sees) mean the tool quietly stops working. Testing ranks here
(#8) rather than lower because the send-window/threading/opt-out logic is exactly the
kind of code you can't safely refactor (for #2/#3/#4) without a harness first.

Remaining security items (#12–#14) are real but low-impact in a single-user tool where
the practical attacker surface only exists after deploy — and #1's fix (auth in
middleware) shrinks most of them. Scalability (#17) is deliberately low: at a 15/day send
cap and hundreds of contacts, none of the O(n) patterns bite for a long time.
Maintainability, docs, product polish, and hygiene close the list — worth doing, not
urgent.

---

## 1. Security

### 1.1 No authentication on dashboard or mutating APIs — RESOLVED 2026-07-08

> Fixed on branch `security-phase-1` per IMPLEMENTATION_PLAN Tasks 1.2–1.4: DASHBOARD_PASSWORD
> + `src/proxy.ts` middleware + `/login` (HMAC session cookie, fail-closed), API hardening
> (1.2/1.3/1.5 items below), docs updated. Functionally verified: unauthenticated `/` → 307
> `/login`, APIs → 401, tracking/cron/health remain public, tampered cookie rejected.
> Items 1.2–1.6 below are likewise addressed except where noted (rate limiting on tracking
> endpoints was explicitly out of scope; OAuth `state` param moot — routes 404 in production).
- **What:** Every route except `/api/cron/*` and `/api/test/*` is completely open. There
  is no login, no session, no middleware. Anyone who discovers the URL can:
  - `POST /api/send-batch` — **send real email from the owner's Gmail** (any approved log);
  - `POST /api/email-logs` / `/api/email-logs/batch` — create *approved* (pre-authorized)
    emails with arbitrary subject/body, then trigger the send — i.e. use the owner's Gmail
    as a spam relay through two unauthenticated calls;
  - `GET /api/contacts`, `/api/email-logs` — read all prospect PII, notes, reply bodies;
  - `DELETE /api/suppressions/[id]` — remove opt-out records (PH DPA exposure);
  - `DELETE /api/contacts/[id]`, `DELETE /api/campaigns/[id]` — destroy data.
- **Why it matters:** deploy is the next planned step (SESSION_NOTES "Pending user
  actions" #4). The design assumption "single-user, self-hosted" was silently converted
  into "single-user, on the public internet" when Vercel was chosen; the code never
  caught up.
- **Found:** absence of any auth check in all `src/app/api/**/route.ts` except the three
  routes using `requireCronSecret` (`src/lib/auth.ts`).

### 1.2 Regex injection / ReDoS in suppression search
- **What:** `GET /api/suppressions?q=...` builds `{ email: { $regex: q } }` from raw user
  input (`src/app/api/suppressions/route.ts:14`). Crafted patterns can cause
  catastrophic backtracking or match-anything queries.
- **Why:** minor for one user, but it's the only place raw user input reaches a query
  operator; trivial to fix (escape the string).

### 1.3 Raw `Model.create(request body)`
- **What:** `POST /api/campaigns` and `POST /api/suppressions` pass the parsed JSON body
  straight to `create()` (`campaigns/route.ts:22`, `suppressions/route.ts:26`). Mongoose
  strict mode drops unknown keys, but schema-typed fields are not sanity-checked:
  `sequenceSpacingDays` accepts `[]`, negative numbers, or wrong lengths (which
  `computeNextSendAt` then papers over with fallbacks); suppression `email` has no format
  validation (normalization exists via `lowercase/trim`, format does not).
- **Why:** invalid spacing silently corrupts scheduling; a malformed suppression entry
  never matches anything and gives false confidence.

### 1.4 Public endpoints: tracking, OAuth
- **What:**
  - `/api/track/open/*` and `/api/track/click/*` are necessarily public but unlimited:
    each hit opens a DB connection and writes. Bots/scanners inflate `openCount` and
    engagement scores (mail-provider proxies already do — a proxy prefetch can mark a
    contact HOT without human action). No rate limiting anywhere.
  - `/api/auth/gmail` flow has **no `state` parameter** (`auth/gmail/route.ts:33`) —
    classic OAuth CSRF gap — and the callback renders the refresh token into the browser.
    Acceptable as a one-time local bootstrap; should not be reachable in production.
- **Why:** score integrity underpins the HOT-lead workflow; the OAuth routes are
  attack surface with no production purpose.

### 1.5 Small items
- `requireCronSecret` uses `!==` (not constant-time compare) — theoretical timing attack.
- `/api/health` returns raw DB error messages (`db: "error", error: message`) which can
  leak connection-string hostnames; it also returns `ok: true` in every case, so an
  uptime monitor can't distinguish healthy from broken.
- Cron endpoints accept `GET` with side effects (fine given the secret, but makes
  accidental triggering via link-prefetch possible if the secret ever leaks into a URL).
- Good practices observed (credit where due): HTML-escaping is consistent
  (`htmlEscape` in tracking/draft/replies; takeover alert escapes CSV-derived fields),
  tracking IDs are `randomUUID`, pixel route never 404s (doesn't leak valid IDs),
  `.env*` is gitignored, review-gate transitions are strictly whitelisted.

### 1.6 Secrets & API-key handling (dedicated audit 2026-07-08)

**Verified good (do not re-audit):**
- `.env.local` is gitignored (`.env*` + `!.env.example`) and was **never committed** —
  checked every commit (55) for the file and for secret patterns (`sk-ant-`, `GOCSPX-`,
  `AIza…`, `mongodb+srv://user:pass@`, refresh-token shapes). Zero hits in history, in
  tracked files, and in the untracked dirs (`graphify-out/`, `.planning/`, etc.).
- All `process.env` reads are server-side (`src/lib/*`, route handlers). There are **no
  `NEXT_PUBLIC_` variables**, so no secret can be inlined into the client JS bundle.
- The cron pinger design sends `CRON_SECRET` as an `x-cron-secret` **header**, not a URL
  query param — it won't land in access logs or referrer headers.

**Findings:**
- **(G-22) Google OAuth publishing status — potential 7-day token death.** For an
  external OAuth consent screen left in **"Testing"** status, Google expires refresh
  tokens after 7 days when sensitive/restricted scopes (both Gmail scopes here) are
  granted. SPEC §4 assumes the token lives "indefinitely"; that is only true once the
  app is published ("In production" — the unverified-app warning is acceptable for
  personal single-user use). If the consent screen is still Testing, sending will
  silently break weekly. Manual verification step in the CLAUDE.md checklist; no code
  change needed (but Task 4.1's error digest is what would make this failure visible).
- **(G-23) Refresh-token blast radius.** `GOOGLE_REFRESH_TOKEN` carries `gmail.send` +
  `gmail.readonly` — whoever holds it can read the entire personal inbox and send as the
  user, until revoked at myaccount.google.com/permissions. Scope reduction isn't
  practical (reply detection needs message bodies), so the mitigations are handling
  hygiene + a known rotation path (CLAUDE.md checklist §C).
- **(G-23) Vercel env-var handling is unspecified.** docs/deployment.md says to add the
  vars but not to mark them **Sensitive** (write-only in the dashboard), nor that scope
  should be Production-only, nor that key values must never go into `APP_BASE_URL`-style
  public config. Checklist items, not code.
- **(G-23) Anthropic key has no blast-radius plan.** When purchased: dedicated key in
  its own workspace with a **monthly spend cap** — the cap is the only real defense
  against a leaked key burning budget, and it costs nothing to set.
- **(G-23) Atlas user is over-privileged by instruction.** deployment.md §1 tells the
  user to grant "Read and write to any database"; scope it to the app database. Network
  access `0.0.0.0/0` is genuinely required for Vercel — compensate with a strong unique
  password and Atlas alerting, and accept it.
- **Code-side leak paths already captured elsewhere** (fixes live in
  IMPLEMENTATION_PLAN Task 1.3): OAuth callback renders the refresh token into browser
  history/cache and stays reachable in production (§1.4); `/api/health` echoes raw Mongo
  error text which can include connection hostnames (§1.5); `requireCronSecret` uses
  non-constant-time compare (§1.5).
- **Third-party custody:** the pinger service (cron-job.org or GitHub Actions secrets)
  stores a copy of `CRON_SECRET` — treat it as shared with that provider and rotate it
  on any account compromise there. GitHub Actions must use repo **Secrets**, never a
  value in the workflow YAML.

## 2. Correctness & Compliance

### 2.1 Non-atomic send ⇒ duplicate emails
- **What:** in `sendOneLog` (`src/lib/sequence.ts:250-395`) the Gmail send succeeds, then
  *four separate* DB writes follow (EmailLog update, Contact update, plus threading
  subject write earlier). If the process dies or Mongo hiccups after
  `sendGmailMessage()` but before `EmailLog.findByIdAndUpdate(... status: "sent")`, the
  log remains `"approved"` and the next cron run **sends the same email again**. There is
  no "sending" intermediate state and no idempotency key.
- **Why:** duplicate cold emails to a prospect are reputation-damaging and unrecoverable.
  This is the most likely real-world correctness failure given serverless kill-at-timeout
  semantics (the run budget check happens *between* logs, not within one).

### 2.2 Opt-out false positives
- **What:** `OPT_OUT_PATTERNS` includes `/\bstop\b/i` (`src/lib/replies.ts:82-86`). A
  reply like "stop by our office next week" or "we're a one-stop shop, tell me more"
  unsubscribes an *interested* lead: status flipped, suppression entry created, pending
  drafts deleted, **no takeover alert sent** (opt-outs skip the alert queue).
- **Why:** the exact contacts this tool exists to catch get silently dropped, and the
  user never finds out (the reply is recorded but no alert fires). The quoted-text
  stripping only protects against the footer echo, not natural language.

### 2.3 Suppression list not checked at send time
- **What:** `sendOneLog` checks `contact.status === "active"` only. An email manually
  added to Suppression (via `/suppressions` UI or API) does not pause the matching
  contact, whose queued/approved logs will still send. deployment.md §7 explicitly
  claims "the suppression list is checked … before every send" — it is not.
- **Why:** the suppression list is the compliance backbone (SPEC §14: "honor opt-outs
  immediately and permanently"). Today it only gates *import*, plus the reply-driven
  auto-path.

### 2.4 Manual `unsubscribed`/`bounced` status changes bypass Suppression
- **What:** CLAUDE.md convention: "`unsubscribed`/`bounced` status changes auto-add to
  Suppression." The only code path that does this is reply-detection opt-out. `PATCH
  /api/contacts/[id]` accepts `status: "unsubscribed"` (it's in `UPDATABLE_FIELDS`) and
  writes it without touching Suppression — so a manual unsubscribe from the contact page
  is not durable: re-importing the same CSV re-inserts and re-emails them.
- **Found:** `src/app/api/contacts/[id]/route.ts:34-57` vs `src/lib/replies.ts:255-265`.

### 2.5 Bounce handling does not exist
- **What:** `"bounced"` is a Contact status and Suppression reason, and
  deployment.md §6 says "If a send bounces, the contact status is set to `bounced` and no
  further emails are sent" — but nothing anywhere detects bounces (no DSN parsing in
  reply polling, no handling of Gmail send errors that indicate invalid recipients).
  Bounced addresses keep receiving follow-ups until stage 3.
- **Why:** repeatedly mailing dead addresses is the classic deliverability killer for a
  warming-up Gmail account; and the runbook actively tells the user a safety net exists.

### 2.6 Delete cascades / orphans
- **What:** `DELETE /api/campaigns/[id]` doesn't check for contacts referencing it;
  `DELETE /api/contacts/[id]` leaves that contact's EmailLogs behind. Orphaned active
  contacts hit "campaign not found" in `generateDrafts` **every run, forever** (error
  each time, contact never advances, `nextSendAt` stays due). Approved logs for missing
  campaigns bounce between approved→draft on every send attempt.
- **Found:** `campaigns/[id]/route.ts:57-70`, `contacts/[id]/route.ts:59-72`,
  `sequence.ts:177-183, 265-274`.

### 2.7 Smaller correctness items
- **Send-window off-by-one:** engine sends `hour >= 8 && hour < 18`
  (`sequence.ts:77-80`) but the UI countdown targets `manilaHour >= 8 && manilaHour <= 18`
  (`useNextSendCountdown.ts:21`) — the dashboard promises an 18:00 send slot that never
  fires (drafts approved at 17:59 appear to have a 1-minute deadline that's actually
  1 hour+).
- **Daily-cap race:** cap enforcement is `countDocuments` → send loop, in both cron and
  `/api/send-batch`; running both concurrently (pinger fires while user clicks Send) can
  exceed the cap. Low probability, but the cap is the warm-up safety mechanism.
- **Reply matching by substring:** `fromHeader.includes(contactEmailLower)`
  (`replies.ts:215`) — `ana@x.com` matches a From of `lana@x.com...`. Edge case.
- **`stats=true` string filters aren't cast:** in the aggregation path, `status`,
  `pipelineStage`, `leadSource` from the query string go into `$match` unvalidated (only
  `campaignId` is validated). Harmless today, but unlike the `find()` path there's no
  cast layer at all.
- **Double placeholder substitution:** `/api/email-logs/batch` substitutes at queue time
  *and* `sendOneLog` substitutes at send time. Currently harmless (idempotent), but the
  stored body being pre-substituted while single-compose bodies aren't is an
  inconsistency waiting to confuse someone.

## 3. Architecture & Design

### 3.1 Sleeping inside a serverless function
- **What:** `sendApproved` sleeps 30–60 s between sends (`sequence.ts:450-452`) inside a
  Vercel function. `maxDuration = 300` is set with a comment saying "Pro plan max," but
  CLAUDE.md targets **Hobby**. If Hobby doesn't honor 300 s in this project's
  configuration, the function is killed mid-batch — which combines badly with 2.1
  (non-atomic send) since kills happen most often during the post-send sleep window.
  Even when it works, you pay compute for sleep.
- **Open question:** confirm actual max duration on the deployed plan before raising
  `SENDS_PER_RUN` above ~3. The 240 s `RUN_TIME_BUDGET_MS` guard helps but only checks
  between sends.

### 3.2 Reply polling is O(active contacts) Gmail calls per run
- **What:** `checkReplies` loads *all* active contacts and does ≥1 `threads.get` per
  contact with a sent log, plus a full `messages.get` per candidate message, every hour
  (`replies.ts:150-237`). No `nextSendAt`/recency windowing, no batching, no
  early-termination via Gmail `history.list`.
- **Why:** fine at 50 contacts; at 1,000 active contacts it's ~10k+ API calls/day and
  multi-minute runs colliding with the time budget. A known ceiling, not a today-bug.

### 3.3 No observability / stuck states
- **What:** the cron run returns a rich `RunSummary`, but the consumer is cron-job.org —
  nobody reads it. Errors are `console.warn`/`console.error` into Vercel's ephemeral
  logs. Consequences:
  - A failing send (e.g., Gmail quota, revoked token) keeps the log `"approved"` and
    retries **silently forever**; nothing surfaces to the dashboard.
  - If the pinger dies, sends just stop; nothing notices (health endpoint always `ok:true`).
  - Draft-generation errors (missing campaign, Claude failures) accumulate invisibly.
- **Why:** an unattended single-user tool needs failures to reach the user; email-to-self
  infrastructure already exists (takeover alert) and could carry error digests.

### 3.4 Model/schema issues
- **EmailLog has no timestamps** (`EmailLog.ts:44` — no `createdAt`); send order relies
  on `_id` sort, and the review queue can't show draft age.
- `Contact.currentStage` uses `enum: [0,1,2,3]` on a Number — works, but pairs oddly
  with `stage: 1|2|3` unions elsewhere; nothing enforces `currentStage` consistency with
  actual sent logs (state is duplicated between Contact and EmailLog and reconciled by
  convention only).
- `firstOpenedAt` race comment in the pixel route claims a conditional write ("only
  write if still null") but the code is a plain `findByIdAndUpdate` — the guard described
  in the comment isn't implemented (`track/open/[pixelId]/route.ts:66-75`). Harmless
  (worst case the timestamp moves slightly), but the comment lies.
- `getManilaDayStart`/window constants hardcode UTC+8 and 8/18 hours (documented, fine)
  — but the window isn't env-tunable while everything around it is.

### 3.5 Duplicated paragraph-rendering logic
- `bodyToHtml` (`draft.ts:179-193`) and `renderTrackedHtml` (`tracking.ts:109+`)
  deliberately duplicate the paragraph/`<br>` logic to avoid a circular dep. Documented,
  but they *will* drift; `bodyToHtml` is now used only by the test endpoint. Extracting
  a tiny shared module (or deleting `bodyToHtml`) removes the risk.

## 4. Code Quality & Maintainability

### 4.1 Zero tests
- **What:** no test files, no test runner in `package.json`. Yet the lib layer was
  explicitly shaped for testing — `sequence.ts` has a section literally headed "Exported
  pure helpers (unit-testable, no DB)" (`getManilaHour`, `isWithinSendWindow`,
  `getManilaDayStart`, `computeNextSendAt`), and `applyPlaceholders`,
  `extractAndRewriteLinks`/`renderTrackedHtml`, `parseContactsCsv`, `stripQuotedText`/
  `isOptOut`/`isGmailReaction`, `buildRawMessage` are all pure.
- **Why:** the fixes for the tier-2 gaps (opt-out patterns, send atomicity, window logic)
  all touch exactly these functions; refactoring them blind is how regressions ship. This
  is the enabling task for half the plan.

### 4.2 Frontend duplication (no shared client layer)
- `apiFetch` is copy-pasted in `review/page.tsx:64-88` and `contacts/[id]/page.tsx:133-150`,
  while dashboard/compose/import use raw `fetch` with `.catch(() => {})` — errors
  swallowed silently (campaigns dropdown just stays empty on failure).
- Design-token constants (`serif/grotesk/mono`, `INK/FAINT/CLAY/...`) are re-declared at
  the top of every page with slight drift already (`FOREST = "#1C4B3A"` in review/compose
  vs `"#1C6E3A"` in contacts/[id]).
- `HOT_THRESHOLD = 5` is hardcoded in three pages while the backend reads
  `HOT_LEAD_THRESHOLD` from env — changing the env var silently desyncs the UI.
- `envInt` is defined three times (`sequence.ts`, `contacts/route.ts`, `send-batch/route.ts`).
- `handleApproveAllSafe` (`review/page.tsx:237-250`) fires sequential PATCHes and ignores
  every error — partial failure looks like success.

### 4.3 Docs drift
- README: scoring "+2 click, +3 reply" (code: +3/+10); "approve or **regenerate**
  drafts" (no regenerate exists); pages table omits `/compose`.
- deployment.md: bounce handling (§6.4) and send-time suppression check (§7) describe
  nonexistent behavior — dangerous drift because it's the go-live runbook.
- CLAUDE.md: "review gate: drafts require approval before sending" is now softened by
  compose/`POST /api/email-logs` creating *directly-approved* logs (documented in
  SESSION_NOTES but CLAUDE.md's Review Gate section wasn't updated); suppression
  auto-add convention (see 2.4) is stated but not implemented.

### 4.4 Repo hygiene
- ~~Untracked-but-present dirs not ignored~~ **RESOLVED 2026-07-08** (git audit):
  `/tools/` (52 MB cloudflared.exe), `/graphify-out/`, `/.planning/`,
  `/design reference/` are now in `.gitignore` and verified via `git check-ignore`.
  `docs/design-brief.md` stays intentionally trackable (it's a doc).
- Git audit 2026-07-08, additional verified facts: 80 tracked files, no binaries or
  build artifacts tracked, largest history blobs are package-lock.json (~270 KB —
  healthy); single branch `main`, **no remote configured yet**. When pushing to GitHub
  for the Vercel deploy: make the repo **private** (it contains outreach strategy docs
  and the design handoff references), and note `git config user.email` is the personal
  Gmail — fine for a private repo; switch to a GitHub noreply address before ever making
  it public. `core.autocrlf=true` causes the recurring LF/CRLF warnings — harmless;
  optionally add a `.gitattributes` with `* text=auto` in a standalone commit to
  normalize (expect a one-time whitespace-only diff).
- `tsconfig.tsbuildinfo` present (ignored — fine).
- Uncommitted working-tree changes (Gmail-reaction filter in `replies.ts` — a real
  behavioral fix — plus HotChip tooltip and `devIndicators: false`) have been sitting
  unstaged across sessions; the reaction fix deserves a commit.

## 5. Product / UX Gaps

- **No post-reply follow-up management (biggest product gap):** the system automates up
  to the reply, then drops the contact — reply detection clears `nextSendAt`, fires one
  alert, and nothing ever resurfaces the contact again. Pipeline stages
  (`call_booked`, `proposal_sent`) are dateless manual markers with no reminders, so
  deals die in the human-follow-up zone the tool exists to feed. *User approved building
  a "next action" layer for this on 2026-07-08 — see IMPLEMENTATION_PLAN Task 6.5.*
- **No draft regeneration:** the review queue lets you edit or discard, but not "ask
  Claude to try again" (with feedback) — the most natural action when a draft misses.
  Discarding a draft causes the next cron run to regenerate it blindly (same inputs →
  similar output), which the user may not realize.
- **Replied contacts fall out of Compose:** `/compose` filters `status=active`, and reply
  detection sets `status: "replied"` — so the exact people you most want to email
  manually can't be selected; manual follow-up must happen in Gmail proper. Likely
  intentional (personal takeover), but nothing tells the user.
- **No unsubscribe link / List-Unsubscribe header:** only "reply STOP." At 15/day this
  isn't Gmail-bulk-sender-mandatory, but a tracked unsubscribe link would (a) reduce
  spam-button clicks, which hurt more, and (b) remove the dependency on the fragile
  keyword matcher (2.2).
- **Approved queue is invisible on the dashboard:** the kicker counts drafts, not
  approved-awaiting-send; after approving, there is no "N approved, sending over the next
  M hours" status anywhere except the review page strip.
- **Paused/bounced/unsubscribed contacts render in "IN SEQUENCE"** on the dashboard
  grouping (grouped purely by `pipelineStage`), with no visual distinction of `status` —
  a paused contact looks identical to an active one.
- **No bulk operations on contacts** (pause campaign, delete selection, move campaign).
- **CSV import has no preview/dry-run** — the summary is after-the-fact; there's also no
  import-history record beyond one localStorage entry.
- **Hardcoded identity** ("Shikks", greeting) — fine for v1, noted as a constraint.
- **Emoji-reaction handling exists only in the uncommitted working tree** — if that edit
  is discarded, a 👍 reaction re-becomes a "reply" that kills the sequence.

## Open Questions (not guessed at)

1. ~~Vercel plan / max duration~~ **ANSWERED 2026-07-10:** target is Hobby, Fluid Compute
   not confirmed. Resolved by Task 4.2 (SENDS_PER_RUN=1, no in-function sleep) so the
   in-function sleep pattern no longer exists — the question no longer gates anything.
2. ~~Is public exposure intended at all?~~ **ANSWERED 2026-07-10:** app-level password auth
   was chosen and shipped (Phase 1). Not relying on Vercel password protection.
3. **Compose for replied contacts** (5.x) — intentional restriction or oversight?
4. **`design reference/`, `graphify-out/`, `.planning/`** — keep in repo (gitignored) or
   are these transient?
5. **`maxDuration = 300` comment** says Pro; CLAUDE.md says Hobby — which is true for the
   actual account?

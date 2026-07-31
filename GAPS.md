# GAPS.md — Architectural & Quality Audit Findings

Audited 2026-07-07 against commit `746f9dd` (plus uncommitted working-tree edits to
`next.config.ts`, `src/components/ui.tsx`, `src/lib/replies.ts`). Full read of models,
lib layer, all API routes; sampled read of all frontend pages; docs cross-checked
against code. No changes were made to source files.

**Reconciliation pass 2026-08-01:** rows 12–14, 17–21 and several Open Questions had
been resolved by remediation phases 2–6 and security phases 1–2 but were never marked
here — this file was last touched 2026-07-08 (rows 22–23 only) while six more phases
of work landed. Verified each claim below by reading the current source (not by
trusting prior session notes). No source files were changed for this pass.

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
| 12 | ~~Regex injection / ReDoS in suppressions search~~ **RESOLVED** (security-phase-1: `escapeRegex`; hardened again security-phase-2 Wave C with a 128-char clamp + `^`-anchor for index use) | Security |
| 13 | ~~Mass-assignment style `Model.create(body)` on campaigns & suppressions~~ **RESOLVED 2026-07-08** (security-phase-1: explicit field-pick + validation on both routes; security-phase-2 Wave B additionally closed 2 NoSQL operator-injection paths on contacts/import) | Security / Validation |
| 14 | ~~Unauthenticated public tracking + OAuth endpoints~~ **PARTIALLY RESOLVED**: OAuth `state` param added (security-phase-2 Wave A) and score inflation fixed (`engagementScore` now bumps only on first open/click — Wave A). Tracking endpoints remain intentionally public with no rate limiting on hit *volume* (only score impact is bounded); accepted risk for a single-user tool | Security |
| 15 | Daily-cap race between cron and manual send-batch — **mostly closed 2026-07-10** by Task 3.1's atomic claim (same log can't double-send; theoretical cap overshoot of 1–2 within a race window remains) | Correctness (minor) |
| 16 | ~~Send-window off-by-one~~ **RESOLVED 2026-07-10** (Task 3.7: countdown hook aligned to engine `< 18`) | Correctness (minor) |
| 17 | ~~No pagination; contacts aggregation `$lookup`s all logs~~ **RESOLVED** (security-phase-2 Wave C: `parseLimit`/`parseOffset` on every list route, default cap 1000/max 5000; `stats=true` `$lookup` now projects 8 fields instead of full docs) | Scalability |
| 18 | ~~Frontend duplication: `apiFetch`, design tokens, `HOT_THRESHOLD`, `envInt`~~ **RESOLVED 2026-07-11** (remediation Task 5.1: `src/components/tokens.ts`, `src/lib/client.ts`, `src/lib/env.ts`, all pages/routes migrated) | Maintainability |
| 19 | ~~Docs drift: README scoring numbers, "regenerate drafts", deployment.md bounce claims~~ **RESOLVED 2026-07-11** (remediation Task 5.3) — re-flagged as a live "keep current" concern, not a one-time fix; CLAUDE.md/deployment.md were updated again 2026-07-31 for security-phase-2's new env vars and deploy-ordering | Docs |
| 20 | Product gaps, itemized: ~~no draft regeneration~~ **RESOLVED** (Task 6.1, `/regenerate` + feedback); ~~no unsubscribe link~~ **RESOLVED** (Task 6.2, one-click token link); ~~approved queue invisible on dashboard~~ **RESOLVED** (Task 6.3, kicker count); ~~CSV import has no preview~~ **RESOLVED** (Task 6.4, client-side dry-run); replied contacts still excluded from Compose *selection* (now shown greyed rather than absent — Task 6.3 — confirmed intentional, see Open Question 3); no bulk pause/delete/move-campaign still open; `handleApproveAllSafe` partial-failure reporting improved (Task 5.1: now reports "approved N of M — K failed" instead of swallowing errors) | Product/UX |
| 21 | ~~Repo hygiene: untracked binary + generated dirs, `.gitignore` gaps~~ **RESOLVED 2026-07-08** (see §4.4 below, which already documented this — table row was just never updated to match) | Hygiene |
| 22 | Google OAuth app in "Testing" status ⇒ Gmail refresh token expires every 7 days (verify/publish) — **operational checklist item, not code**; status unknown without checking console.cloud.google.com, see CLAUDE.md §A.1 | Reliability / Secrets |
| 23 | Secrets hygiene is manual-config, not code: Vercel sensitive-var flags, key scoping, spend caps, rotation runbook — **checklist now lives in CLAUDE.md** ("Secrets & Deployment Security Checklist"), walk that instead of this row | Security / Ops |

*Rows 22–23 appended 2026-07-08 from a dedicated secrets/API-key audit (§1.6) — kept at
the end to preserve existing cross-references. By severity, #22 belongs in the
reliability tier (~rank 9): if the OAuth consent screen is still in Testing status, the
refresh token verified on 2026-07-05 silently dies within a week and all sending stops.*

### Prioritization logic (as originally written 2026-07-07 — kept for history)

This codebase is **code-complete but not yet deployed** (SESSION_NOTES: Vercel deploy and
credentials are pending user actions). That reframes severity: the classic "highest CVSS
first" ordering matters less than *what breaks the moment this goes live*. #1 is alone at
the top because deployment is the very next planned step, and on a public Vercel URL the
unauthenticated API hands any visitor the ability to send email from the owner's personal
Gmail, read every prospect's PII, and delete legally-required opt-out records. Nothing
else on the list can be safely fixed "later" if this ships first — so it gates deploy.

**Status update 2026-08-01:** the app has since deployed and is live in production
(security-phase-2 confirmed working against the real Atlas cluster, 2026-07-31). #1 and
essentially everything below it through #14 are now resolved — see the ranked table
above. What's left open is mostly reliability/product polish (#15, #20's remaining
sub-items) plus two operational checklist items (#22, #23) that live in CLAUDE.md now
rather than as code gaps.

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

### 1.2 Regex injection / ReDoS in suppression search — RESOLVED

> Fixed on `security-phase-1` (`escapeRegex`); hardened further on `security-phase-2`
> Wave C, which additionally clamps `q` to 128 chars and anchors the pattern with `^` so
> the query can use the unique `email` index instead of a full collection scan. See
> `src/app/api/suppressions/route.ts` — the inline comment there explains why the anchor
> is load-bearing and shouldn't be "simplified" away.
- **What (original finding):** `GET /api/suppressions?q=...` built `{ email: { $regex: q } }`
  from raw user input with no escaping.

### 1.3 Raw `Model.create(request body)` — RESOLVED 2026-07-08

> Fixed on `security-phase-1`: both routes now build an explicit field-pick payload with
> per-field validation (`src/app/api/campaigns/route.ts`, `src/app/api/suppressions/route.ts`
> — `validateSequenceSpacingDays`, email format + reason-enum checks). `security-phase-2`
> Wave B additionally closed two confirmed NoSQL operator-injection paths on
> `POST /api/contacts` and the CSV-import JSON branch (a `campaignId: {"$ne": null}` style
> payload had turned a dedupe lookup into a cross-campaign email-existence oracle).
- **What (original finding):** `POST /api/campaigns` and `POST /api/suppressions` passed
  the parsed JSON body straight to `create()`; schema-typed fields weren't sanity-checked.

### 1.4 Public endpoints: tracking, OAuth — PARTIALLY RESOLVED

> `security-phase-2` Wave A added the missing OAuth `state` parameter (see
> `src/app/api/auth/gmail/route.ts` — bound to a short-lived `gmail_oauth_state` cookie,
> verified by the callback before any code exchange) and changed scoring so
> `engagementScore` only increments on the *first* open/click per log (`bumpEngagement`
> is called inside an atomic `{firstOpenedAt: null}` / `{firstClickedAt: null}` filter, so
> a replayed pixel/link hit can no longer inflate the hot-lead score without limit).
- **Still open:** `/api/track/open/*` and `/api/track/click/*` remain necessarily public
  with no rate limit on request *volume* — a scanner can still make the DB do work on
  every hit, it just can't move the score anymore. Accepted as low-impact for a
  single-user tool with no public marketing of the tracking URLs.
- **Why it still matters some:** DB load from abuse is possible even though the
  compliance-relevant consequence (fake hot leads) is closed.

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

*Sections 2.1–2.6 below were all fixed by remediation Phases 2–3 (2026-07-10, branch
`remediation-phases-2-3`) — the ranked table above has carried the RESOLVED strikethrough
for rows 2–7 since that date, but these prose sections were never updated to match until
this reconciliation pass. Left as historical "what was wrong" write-ups with a fix banner,
same pattern as §1.1–1.4.*

### 2.1 Non-atomic send ⇒ duplicate emails — RESOLVED 2026-07-10

> Fixed by Task 3.1: `sendOneLog` now atomically claims `approved → "sending"` before
> calling Gmail (a second claimer sees a no-op and skips). A pre-send Gmail error reverts
> to `"approved"` for auto-retry; a post-send failure reverts to `"draft"` so a human
> verifies against Gmail Sent instead of an auto-resend risking a duplicate. A stale-
> sending sweep at the start of every engine run reverts anything stuck > 10 min.
- **What (original finding):** the Gmail send succeeded, then four separate DB writes
  followed with no atomic claim — a mid-write crash left the log `"approved"` and the
  next cron run sent the same email again.

### 2.2 Opt-out false positives — RESOLVED 2026-07-10

> Fixed by Task 3.2: bare `/\bstop\b/i` replaced with an intent-anchored matcher (whole-
> message equality plus explicit intent phrases — see the asymmetry rationale in
> `src/lib/replies.ts`). Opt-outs now also fire their own takeover alert instead of
> silently skipping the alert queue (the alert queue itself was newly built this same
> phase — see 3.3's resolution note).
- **What (original finding):** "stop by our office" or "one-stop shop" would unsubscribe
  an interested lead with no alert.

### 2.3 Suppression list not checked at send time — RESOLVED 2026-07-10

> Fixed by Task 3.3: suppression is now checked inside both `sendOneLog` and
> `generateDrafts`, not just at import.
- **What (original finding):** a manually-added Suppression entry didn't pause the
  matching contact's queued/approved sends.

### 2.4 Manual `unsubscribed`/`bounced` status changes bypass Suppression — RESOLVED 2026-07-10

> Fixed by Task 3.4: shared `suppressContact` helper (`src/lib/contacts.ts`) now runs on
> `PATCH /api/contacts/[id]` whenever status moves to `unsubscribed`/`bounced`, so it's a
> durable Suppression entry rather than a Contact-only status flip.
- **What (original finding):** a manual unsubscribe from the contact page didn't write to
  Suppression, so re-importing the same CSV would re-insert and re-email them.

### 2.5 Bounce handling does not exist — RESOLVED 2026-07-10

> Fixed by Task 3.5: a conservative send-time classifier (`isInvalidRecipientError`)
> catches clear invalid-recipient errors at send time (→ suppress + `"bounced"`), plus an
> env-gated (`BOUNCE_POLL_DETECTION`, default on) mailer-daemon/postmaster poll scan
> during reply-checking.
- **What (original finding):** `"bounced"` existed as a status/reason but nothing ever
  set it — dead addresses kept receiving follow-ups until stage 3.

### 2.6 Delete cascades / orphans — RESOLVED 2026-07-10

> Fixed by Task 3.6: campaign delete now 409s if any contact still references it; contact
> delete cascades its EmailLogs.
- **What (original finding):** deleting a campaign or contact left orphaned references
  that `generateDrafts` would error on forever.

### 2.7 Smaller correctness items — RESOLVED except the daily-cap race 2026-07-10

> All fixed by Task 3.7 except the daily-cap race, which is separately tracked as ranked
> row 15 (mostly closed by Task 3.1's atomic claim, a 1–2 overshoot within a race window
> is the accepted residual). Reply matching moved to exact-address equality
> (`extractFromAddress`, not substring); stats aggregation `$match` fields now go through
> enum whitelists; queue-time placeholder substitution was removed entirely — send-time
> substitution in `sendOneLog` is the single path now.
- ~~Send-window off-by-one~~ — countdown hook realigned to the engine's `< 18` (ranked
  row 16).
- **Daily-cap race** — still open, see ranked row 15.
- ~~Reply matching by substring~~ — now exact From-address equality.
- ~~`stats=true` string filters aren't cast~~ — now whitelisted.
- ~~Double placeholder substitution~~ — queue-time substitution removed.

## 3. Architecture & Design

### 3.1 Sleeping inside a serverless function — RESOLVED 2026-07-10

> Fixed by Task 4.2: the inter-send sleep was removed from the cron path entirely.
> `SENDS_PER_RUN=1` default, no sleep, Hobby confirmed as the deploy target (the code
> comments in `src/app/api/cron/sequence/route.ts` now say so directly instead of the old
> "Pro plan max" claim) — a single run stays well inside a 60 s ceiling.
- **What (original finding):** `sendApproved` slept 30–60 s between sends inside a
  function whose actual max duration on Hobby was unconfirmed.

### 3.2 Reply polling is O(active contacts) Gmail calls per run

**Still open** — no windowing/batching/`history.list` early-termination has been added.
Accepted as "fine at current scale, known ceiling" per the original note; revisit if
active-contact count approaches the hundreds.

### 3.3 No observability / stuck states — RESOLVED 2026-07-10

> Fixed by Task 4.1: every engine run now writes a `CronRun` doc (30-day TTL); the
> dashboard shows a last-run strip with a PINGER-STALE warning; the engine emails a
> self-digest on errors (throttled to one per Manila day); the review page surfaces
> `lastSendError`. `/api/cron-runs` (auth-protected) powers the dashboard strip.
- **What (original finding):** `RunSummary` was returned but nobody read it; failures
  accumulated silently with no way for the user to notice.

### 3.4 Model/schema issues — mostly RESOLVED

> `EmailLog` gained `createdAt` (Task 5.2, `{timestamps:{createdAt:true,updatedAt:false}}`)
> — send order and draft age are no longer purely `_id`-order guesswork (though logs from
> before 2026-07-11 still lack it and fall back to `_id` sort for those). The
> `firstOpenedAt`/`firstClickedAt` race was actually fixed as part of security-phase-2
> Wave A — both tracking routes now do the atomic `{_id, firstOpenedAt: null}` conditional
> update the old comment merely claimed to do.
- **Still open (low priority, not re-verified this pass):** `Contact.currentStage` vs.
  `EmailLog.stage` duplication-by-convention, and the hardcoded (non-env-tunable) Manila
  window constants — both accepted as fine at current scale.

### 3.5 Duplicated paragraph-rendering logic — RESOLVED 2026-07-11

> Fixed by Task 5.4: `bodyToHtml` was deleted from `draft.ts`; the test endpoint now calls
> `renderTrackedHtml` directly, removing the drift risk entirely instead of just
> documenting it.

## 4. Code Quality & Maintainability

### 4.1 Zero tests — RESOLVED 2026-07-10, and grown since

> Fixed by Task 2.1 (vitest, 164 baseline tests over the pure lib layer), then grown
> through every later phase: 221 (Task 5.1/5.4 net), 235, 303 (Phase 6), 486, and 566 as
> of security-phase-2 (2026-07-31). Run with `npm test`.

### 4.2 Frontend duplication (no shared client layer) — RESOLVED 2026-07-11

> Fixed by Task 5.1: `src/lib/client.ts` (`apiFetch<T>` + `HOT_THRESHOLD` reading
> `NEXT_PUBLIC_HOT_LEAD_THRESHOLD`), `src/components/tokens.ts` (fonts+palette, the two
> forest greens now distinctly named `FOREST_ACTION`/`FOREST_WON`), `src/lib/env.ts`
> (`envInt`) — all pages/routes migrated to the shared modules. The previously-swallowed
> `.catch(() => {})` fetches now surface errors (dashboard config-error strip, compose/
> import campaign-load errors). `handleApproveAllSafe` now reports "approved N of M — K
> failed" instead of silently looking like full success.

### 4.3 Docs drift — RESOLVED 2026-07-11, re-verify periodically

> Fixed by Task 5.3 (README scoring/regenerate/`/compose` corrected, deployment.md
> reconciled, CLAUDE.md Review Gate section annotated with the compose/direct-approve
> exception). This category isn't a one-time fix though — CLAUDE.md and deployment.md
> were touched again 2026-07-31 for security-phase-2's new env vars and deploy-ordering
> requirements, and will need the same treatment after future phases. Treat "is docs
> drift currently zero" as a question to re-ask, not a permanently-closed finding.

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
- ~~Uncommitted working-tree changes (Gmail-reaction filter in `replies.ts`...)~~
  **RESOLVED** — these landed in a commit long ago; nothing has sat unstaged across
  sessions since. (Ranked-table row 21 previously still listed this section as open;
  it wasn't, the table just hadn't been synced with this paragraph.)

## 5. Product / UX Gaps

*Most items below were closed by remediation Phase 6 (2026-07-13, branch
`remediation-phase-6`, all 6 tasks landed). Kept as history with fix notes; still-open
ones are marked accordingly.*

- ~~No post-reply follow-up management~~ **RESOLVED** (Task 6.5): `Contact.nextActionAt`/
  `nextActionNote` + a once-per-Manila-day overdue-actions email digest (engine step D)
  + dashboard OVERDUE/DUE-TODAY chips + contact-detail Save/Clear controls.
- ~~No draft regeneration~~ **RESOLVED** (Task 6.1): `POST /api/email-logs/[id]/regenerate`
  (draft-only, accepts optional feedback) + a Regenerate button with inline feedback on
  the review queue.
- **Replied contacts still excluded from Compose selection** — genuinely still true, but
  no longer *invisible*: Task 6.3 renders them greyed/non-selectable instead of vanishing,
  and this is confirmed intentional (see Open Question 3), not an oversight.
- ~~No unsubscribe link~~ **RESOLVED** (Task 6.2): `Contact.unsubscribeToken` (UUID),
  public `GET /api/unsubscribe/[token]` → shared `suppressContact`, neutral confirmation
  page with no token-validity leak, link appended at send time (excluded from
  click-tracking rewriting via `isUnsubscribeUrl` so it isn't itself a tracked redirect).
- ~~Approved queue is invisible on the dashboard~~ **RESOLVED** (Task 6.3): kicker now
  shows an approved-awaiting-send count alongside the draft count.
- **Paused/bounced/unsubscribed contacts still render in "IN SEQUENCE"** — not
  addressed by Phase 6; still grouped purely by `pipelineStage` with no `status` visual
  distinction. Still open.
- **No bulk operations on contacts** (pause campaign, delete selection, move campaign) —
  still open, not touched by any phase to date.
- ~~CSV import has no preview/dry-run~~ **RESOLVED** (Task 6.4): client-side papaparse
  dry-run on `/import` reusing the server's `parseContactsCsv`/`isValidEmail` (extracted
  to `src/lib/email.ts`); the actual upload path is unchanged.
- **Hardcoded identity** ("Shikks", greeting) — still true, still fine for v1.
- ~~Emoji-reaction handling exists only in the uncommitted working tree~~ **RESOLVED** —
  this was committed long ago; the working tree has been clean of this edit for many
  sessions (see §4.4's hygiene note above, which already said as much before this row
  was reconciled).

## Open Questions (not guessed at)

1. ~~Vercel plan / max duration~~ **ANSWERED 2026-07-10:** target is Hobby, Fluid Compute
   not confirmed. Resolved by Task 4.2 (SENDS_PER_RUN=1, no in-function sleep) so the
   in-function sleep pattern no longer exists — the question no longer gates anything.
2. ~~Is public exposure intended at all?~~ **ANSWERED 2026-07-10:** app-level password auth
   was chosen and shipped (Phase 1), then hardened further in security-phase-2 (session
   no longer derived from the password itself). Not relying on Vercel password protection.
3. ~~Compose for replied contacts~~ **ANSWERED:** intentional restriction (manual
   follow-up happens in Gmail once someone replies). Remediation Task 6.3 made this
   visible instead of silent — replied contacts now render greyed/non-selectable in
   Compose rather than simply vanishing from the list.
4. **`design reference/`, `graphify-out/`, `.planning/`** — **ANSWERED:** gitignored as of
   2026-07-08 (CLAUDE.md "Local-workspace dirs" note); `design reference/` is deliberately
   kept local-only as the visual source of truth, the other two are working-scratch dirs.
5. ~~`maxDuration = 300` comment says Pro; CLAUDE.md says Hobby~~ **ANSWERED:** both
   `src/app/api/cron/sequence/route.ts` and `check-replies/route.ts` now say "Deploy
   target is Hobby, which may cap this" in the comment itself — the drift is gone, Hobby
   is confirmed the target, and `SENDS_PER_RUN=1` with no in-function sleep (Task 4.2)
   keeps a run inside Hobby's ceiling regardless.

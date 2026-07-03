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
```

## Non-Goals (v1)

No multi-user support, no A/B testing, no Gmail push notifications (polling only), no automated proposal generation.

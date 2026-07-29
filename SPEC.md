# Email Outreach Automation — Technical Spec & Architecture

**Purpose:** A self-hosted system to automate cold email outreach to Philippine small businesses — contact management, AI-assisted personalization, a 3-touch follow-up sequence, tracking (opens, clicks, replies), a sales pipeline, lead scoring, and a human takeover alert.

**How to use this doc:** Feed this into Claude Code as your spec (drop it in as `SPEC.md` alongside a `CLAUDE.md`/`SESSION_NOTES.md`). Build it phase by phase per the plan at the end — don't try to build everything in one shot.

> **Amendment — multi-channel outreach (2026-07-29).** This spec describes an *email-only*
> system, and that remains the description of the automated path. Since it was written, the
> tool also ingests the Maps Lead Scraper's CSV export, which contains **no email addresses**
> — those leads are reached over Facebook, Instagram or phone instead.
>
> The intent change is narrow but important: ShikksTracker is now an outreach CRM with **one
> automated channel (email) and several manually-tracked channels**. Email is the only
> channel with a ToS-safe cold-outreach API, so for the others the system AI-drafts the
> message, tells you it's due, and records that you sent it — but *you* send it, on the
> platform. Everything in §4–§8 (Gmail sending, threading, open/click tracking) and §13
> (reply detection and the takeover alert) is **email-only by design** and deliberately does
> not apply to the other channels; responses there are recorded by moving the pipeline stage
> by hand.
>
> Sections §3 (data models), §5 (sequence engine) and §9 (import) are extended rather than
> replaced — see the "Multi-channel amendment" section of `CLAUDE.md` for the field-level
> detail, the three-place email-only send invariant, and the legacy-log convention.

---

## 1. Goals & Non-Goals

**Goals**
- You add contacts (CSV or manual), each with a few personalization notes, a lead source, and checked against a suppression list.
- Claude API drafts each email (initial + 2 follow-ups) from your key points.
- System sends via your own Gmail, spaced 1–2 weeks across the sequence.
- Sequence auto-stops if the contact replies, and you get alerted immediately so you can take over personally.
- Opens, link clicks, and replies feed an engagement score and a sales pipeline.
- Dashboard shows sent/opened/clicked/replied status, pipeline stage, and lead score per contact and per campaign.

**Non-goals (v1)**
- No multi-user/team support — single user (you).
- No A/B testing of subject lines.
- No Gmail push notifications (Pub/Sub) — reply detection is polling-based for simplicity. Can upgrade later.
- No automated proposal generation — proposal-sent is a manually-marked pipeline stage for now.

---

## 2. Tech Stack

- **Framework:** Next.js (App Router) — matches your existing stack, handles both UI and API routes in one project.
- **Database:** MongoDB (Atlas free tier is fine to start).
- **Email sending:** Gmail API (OAuth2), via `googleapis` npm package.
- **AI personalization:** Anthropic API (`@anthropic-ai/sdk`).
- **Scheduling:** Cron-triggered API route. On Vercel, use Vercel Cron (note: Hobby plan only supports daily-interval crons — for finer control, use Render/a small VPS with `node-cron` or system crontab hitting a protected endpoint hourly).
- **Deployment target:** Your call — Render or a VPS gives you more scheduling flexibility than Vercel's free tier.

---

## 3. Data Models

### Contact
```
{
  _id,
  businessName: string,
  contactEmail: string,
  contactName?: string,
  keyPoints: string,          // your notes: pain point, context, personalization hook
  importMethod: "csv" | "manual",
  leadSource: "cold_email" | "referral" | "event_connection" | "other",
  campaignId: ObjectId,
  status: "active" | "paused" | "replied" | "bounced" | "unsubscribed",
  currentStage: 0 | 1 | 2 | 3,        // 0=not started, 1=initial sent, 2=followup1 sent, 3=followup2 sent
  pipelineStage: "not_started" | "contacted" | "replied" | "call_booked" | "proposal_sent" | "won" | "lost",
  engagementScore: number,            // computed, see §12
  nextSendAt: Date | null,
  createdAt: Date
}
```

### Campaign
```
{
  _id,
  name: string,
  offerSummary: string,      // what you're pitching — feeds the AI prompt
  toneNotes: string,         // e.g. "casual, direct, no corporate jargon"
  sequenceSpacingDays: [0, 5, 9],  // days-from-start for each touch (tune to your "1-2 weeks" pref)
  createdAt: Date
}
```

### EmailLog
```
{
  _id,
  contactId, campaignId,
  stage: 1 | 2 | 3,
  subject: string,
  body: string,
  gmailThreadId: string,
  gmailMessageId: string,
  sentAt: Date,
  trackingPixelId: string,
  openCount: number,
  firstOpenedAt: Date | null,
  links: [{ url: string, trackingId: string }],   // rewritten links for click tracking
  clickCount: number,
  firstClickedAt: Date | null,
  replied: boolean,
  repliedAt: Date | null
}
```

### Suppression (NEW)
```
{
  _id,
  email: string,              // indexed, lowercase-normalized
  reason: "unsubscribed" | "bounced" | "manual",
  addedAt: Date
}
```
Checked on every CSV import and manual contact add — matching emails are skipped (or flagged for review, your call) rather than inserted. A contact is automatically added here when their `status` flips to `unsubscribed` or `bounced`.

---

## 4. Gmail API Integration

**Setup (one-time, manual):**
1. Create a project in Google Cloud Console, enable the Gmail API.
2. Configure OAuth consent screen — "Internal" isn't available unless you're on Workspace; for a personal Gmail, use "External" + add yourself as a test user (fine indefinitely for single-user personal use).
3. Create OAuth Client ID (type: Web application), add a redirect URI like `https://yourapp.com/api/auth/gmail/callback`.
4. Run a one-time local auth flow to get a **refresh token** — store it as an env var (`GOOGLE_REFRESH_TOKEN`). You won't need to repeat this; the refresh token doesn't expire under normal use.

**Sending:**
- Use `googleapis` Gmail `users.messages.send`, authenticated via the stored refresh token (no user-facing login needed since it's just you).
- Build raw MIME messages so you can set threading headers (`In-Reply-To`, `References`) — keeps follow-ups in the same Gmail thread as the original, which reads more human and makes reply detection easier.
- **Throttle sends** — add random delays (e.g., 30–90 seconds apart) between sends in the same batch, and cap sends per run to stay well under Gmail's daily limit (~500/day personal, ~2,000/day Workspace).

**Reply detection (polling approach):**
- For every contact with `status: active` and a `gmailThreadId`, periodically call `users.threads.get` and check if the thread has a message from the recipient's address newer than your last sent message.
- If found: set `status: "replied"`, `pipelineStage: "replied"`, clear `nextSendAt`, log `repliedAt`, bump `engagementScore`, and fire the human takeover alert (§13).
- If the reply body contains an opt-out keyword (e.g. "STOP", "unsubscribe"): set `status: "unsubscribed"` instead, and add to Suppression.
- Run this check in the same cron pass as the sequence engine — no need for a separate job.

---

## 5. Sequence Engine

Runs on a cron-triggered endpoint (protect it with a shared secret header, e.g. `CRON_SECRET`).

**Each run:**
1. Check replies first (§4) — mark replied/unsubscribed contacts, remove them from the send queue.
2. Query contacts where `status: "active"` and `nextSendAt <= now`.
3. For each: generate the email (§6), rewrite links for click tracking (§8), send it, log it, bump `currentStage`, set `pipelineStage: "contacted"` if this was stage 1, compute the next `nextSendAt` (or null if stage 3 is done).
4. Respect a daily send cap across the whole run — if you hit it, defer the rest to the next run.
5. Only send within a sane time window (e.g., 8am–6pm PH time) — schedule the cron hourly during that window rather than sending at 3am.

---

## 6. AI Personalization Flow

- When a send is due, call the Claude API with: `Campaign.offerSummary`, `Campaign.toneNotes`, `Contact.keyPoints`, `Contact.businessName`, and the stage number.
- Prompt should instruct Claude to write a short, non-generic email (under ~120 words), reference the specific key points, avoid spammy phrasing, and include a one-line opt-out note.
- Store the generated `subject`/`body` in the EmailLog *before* sending — gives you an audit trail and a place to add a manual-review gate later if you want one.

---

## 7. Open Tracking

- Embed a 1x1 transparent pixel: `<img src="https://yourapp.com/api/track/open/{trackingPixelId}" width="1" height="1" />`.
- API route logs the hit (increment `openCount`, set `firstOpenedAt` if unset, bump `engagementScore`) and returns a tiny transparent PNG.
- **Caveat:** open tracking is inherently unreliable — Apple Mail Privacy Protection and Gmail's image proxying can register false "opens" or block them entirely. Treat it as a rough signal; reply and click tracking matter more.

---

## 8. Link Click Tracking (NEW)

- After the AI drafts an email, scan the body for any links. For each one, generate a `trackingId`, store `{ url, trackingId }` on the EmailLog's `links` array, and replace the link in the outgoing email with `https://yourapp.com/api/track/click/{trackingId}`.
- That route logs the click (increment `clickCount`, set `firstClickedAt` if unset, bump `engagementScore` — clicks should weigh more heavily than opens), then issues a 302 redirect to the original URL.
- This is a much stronger interest signal than opens — a contact who clicks through to your portfolio is worth a personal follow-up regardless of where they are in the automated sequence.

---

## 9. Contact Import & Suppression Checking

- **CSV upload:** parse with `papaparse` or similar, map columns to `businessName`, `contactEmail`, `keyPoints`, `leadSource`. Validate email format, check each against the Suppression collection (skip or flag matches), dedupe against existing contacts, insert as `status: "active"`, `currentStage: 0`, `pipelineStage: "not_started"`, `nextSendAt: now`.
- **Manual entry:** same fields via a form, same suppression check before insert.

---

## 10. Lead Source Tagging (NEW)

- `leadSource` is set at import (CSV column or manual form field): `cold_email`, `referral`, `event_connection`, `other`.
- Dashboard should support filtering/grouping by this field, and ideally a simple breakdown showing win rate per source over time — this is what tells you whether cold email is actually worth the effort compared to, say, ACM/event connections.

---

## 11. Pipeline Stages (NEW)

`pipelineStage` values: `not_started → contacted → replied → call_booked → proposal_sent → won / lost`.

- `not_started → contacted`: automatic, set when the first sequence email sends.
- `contacted → replied`: automatic, set on reply detection (§4).
- `replied → call_booked`, `→ proposal_sent`, `→ won`, `→ lost`: manual, updated by you from the dashboard as the real-world conversation progresses. No calendar/proposal integration in v1, so these are just status markers you update yourself.
- This is the layer that turns the tool from "an email sender" into something that shows you actual pipeline health, not just send/open counts.

---

## 12. Engagement-Based Lead Scoring (NEW)

- Simple additive score on Contact, recalculated whenever an event logs: e.g. `+1` per open, `+3` per click, `+10` on reply (regardless of sentiment — a reply is a reply).
- Dashboard should be sortable by `engagementScore` and support a "hot leads" filter (score above a threshold you set) — this is your daily shortlist of who to personally check in on, rather than relying purely on the automated sequence.

---

## 13. Human Takeover Alert (NEW)

- The moment a contact's `status` flips to `replied`, fire a notification outside the app so you see it fast — automated sequences should never be the thing handling an interested reply.
- Simplest option (no new integration): send yourself an email via the Gmail API you've already wired up — subject like "Reply from {businessName}", body with a link to that contact's dashboard page.
- Better for speed: a push notification via **ntfy.sh** (no signup, just POST to a topic URL you pick) or a **Telegram bot** (a bit more setup, but push notifications to your phone). Worth upgrading to once the email-based version proves the flow works.
- This should be the very last thing that runs in the reply-detection step, so it never gets skipped even if something else in that pass fails.

---

## 14. Compliance & Deliverability Notes

- **PH Data Privacy Act (2012):** B2B cold outreach using publicly available business contact info generally falls under "legitimate interest," but keep it clean — don't scrape personal (non-business) emails, keep the suppression list authoritative, and honor opt-outs immediately and permanently.
- **Every email needs an easy opt-out line** — the reply-keyword handling in §4 already routes "STOP"/"unsubscribe" replies into the Suppression collection.
- **Throttle aggressively** early on — a sudden burst of outbound email from a previously quiet Gmail account is the #1 trigger for spam flags.

---

## 15. Dashboard

- **Contacts view:** table with business name, lead source, pipeline stage, status, current sequence stage, last sent date, open/click/reply indicators, engagement score. Filterable by campaign, pipeline stage, lead source; sortable by engagement score.
- **Campaign view:** funnel per stage (sent → opened → clicked → replied) as counts or a simple bar chart, plus a pipeline breakdown (how many contacts at each pipeline stage).
- **Lead source breakdown:** win rate / reply rate grouped by `leadSource`.
- **Contact detail:** timeline of all EmailLog entries (subject, sent date, open/click/reply status) plus manual pipeline-stage controls.
- **Suppression list view:** searchable list, mostly for auditing — confirming someone who opted out won't get re-added.

---

## 16. Environment Variables Needed

```
MONGODB_URI=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
ANTHROPIC_API_KEY=
APP_BASE_URL=            # for tracking pixel, click redirects, threading links
CRON_SECRET=             # protects the sequence-engine endpoint

# Optional, only if you upgrade the takeover alert beyond email:
NTFY_TOPIC_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

---

## 17. Phased Build Plan (for Claude Code)

Work through these in order, one session/phase at a time — commit after each.

1. **Project setup** — Next.js app, MongoDB connection, env config, deploy a "hello world" to confirm hosting works end to end.
2. **Data models** — Contact (with leadSource/pipelineStage/engagementScore), Campaign, EmailLog, Suppression + basic CRUD API routes.
3. **Contact import** — CSV upload + manual entry, wired to suppression checking and lead source tagging.
4. **Gmail OAuth + manual send test** — get the one-time auth flow working locally, store the refresh token, send yourself one test email to confirm the pipeline works.
5. **AI personalization** — wire the Claude API call, test generating a draft from sample key points before connecting it to real sending.
6. **Sequence engine** — cron endpoint: due-send query, generate + send + log, stage advancement, daily cap logic. Test with a fake contact and short spacing (minutes, not days) first.
7. **Open tracking pixel** — endpoint + pixel embed, confirm it logs a hit.
8. **Link click tracking** — link rewriting + redirect endpoint, confirm a click logs correctly.
9. **Reply detection + suppression handling** — thread-polling logic, opt-out keyword handling, confirm status transitions correctly.
10. **Pipeline stage automation** — auto-transitions on send/reply; manual stage controls in a basic UI.
11. **Engagement scoring** — scoring logic tied to open/click/reply events, "hot leads" filter.
12. **Human takeover alert** — start with the email-to-self version; upgrade to ntfy/Telegram later if you want.
13. **Dashboard UI** — contacts table, campaign funnel, lead source breakdown, suppression list view.
14. **Production cron + real spacing** — switch sequence spacing to real days, set up the actual scheduled trigger, do a small real test batch before going full volume.

---

## 18. Open Questions to Resolve Before/During Build

- Exact spacing for the 3 touches (e.g., day 0 / day 5 / day 9) — pick numbers that fit "1–2 weeks."
- Daily send cap you're comfortable with while warming up (suggest starting at 15–20/day and increasing gradually).
- Score threshold for what counts as a "hot lead."
- Whether to start the takeover alert on email-to-self or go straight to ntfy/Telegram.
- Whether you want a manual "review before send" toggle for AI-drafted emails, at least initially.

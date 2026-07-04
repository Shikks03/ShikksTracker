# ShikksTracker — Email Outreach Automation

A self-hosted tool for automating cold-email outreach to Philippine small businesses. It manages contacts, generates AI-personalized 3-touch email sequences via the Claude API, sends through your own Gmail account, and tracks opens, clicks, and replies to power a live sales pipeline with engagement-based lead scoring.

---

## Features

- **Contact management** — manual entry or CSV import with automatic suppression-list checking (duplicates and opt-outs are skipped on import)
- **AI-drafted sequences** — Claude API writes each of the 3 emails (initial + 2 follow-ups) from your offer summary and per-contact key points
- **Review gate** — every draft must be approved before it enters the send queue; you read every email before it goes out
- **Open / click / reply tracking** — 1x1 tracking pixel, redirecting link wrapper, and hourly Gmail inbox polling
- **Lead scoring** — engagement score increments on open (+1), click (+2), reply (+3); hot leads flagged at score >= 5
- **Pipeline** — per-contact stage (not started → contacted → replied → call booked → proposal sent → won / lost) updated automatically or manually
- **Takeover alert** — on first reply the sequence auto-stops and you receive an immediate email-to-self alert so you can respond personally

---

## Local Dev Quickstart

```powershell
npm install
copy .env.example .env.local
```

Open `.env.local` and fill in at minimum:

```
MONGODB_URI=mongodb+srv://...
```

Then set up Gmail OAuth (see `docs/gmail-setup.md`) to populate `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN`, and add your `ANTHROPIC_API_KEY`.

```powershell
npm run dev
```

App is available at `http://localhost:3000`.

---

## Pages

| Path | Purpose |
|---|---|
| `/` | Dashboard — campaign stats, recent activity |
| `/contacts/[id]` | Contact detail — email log, pipeline stage, engagement score |
| `/campaigns` | Campaign list and creation |
| `/review` | Draft review queue — approve or regenerate drafts before sending |
| `/import` | CSV import with suppression-check summary |
| `/suppressions` | Suppression list management |

---

## Documentation

- **`docs/gmail-setup.md`** — Create a Google Cloud project, enable the Gmail API, configure OAuth, and obtain the refresh token
- **`docs/cron-setup.md`** — Set up the external hourly pinger (cron-job.org or GitHub Actions) for the sequence engine
- **`docs/deployment.md`** — End-to-end go-live runbook: MongoDB Atlas, Vercel, smoke tests, warm-up guidance, and compliance reminders

---

## Project Files

| File | Role |
|---|---|
| `SPEC.md` | Authoritative technical spec and architecture reference |
| `CLAUDE.md` | Working summary of decisions made after the spec; the context file fed to Claude Code at the start of each session |
| `SESSION_NOTES.md` | Phase-by-phase build progress log; updated at the end of each session |

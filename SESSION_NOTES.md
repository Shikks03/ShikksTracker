# SESSION_NOTES.md — Build Progress

**Current phase:** 1 — Project setup (not started)

Build one phase per session, in order (SPEC.md §17). Commit after each phase. When a phase completes, check it off, fill in its Notes line, and move the "Current phase" pointer.

## Decisions Locked (2026-07-04 interview)

- Deploy: Vercel Hobby; sequence engine triggered by an external hourly pinger (cron-job.org or GitHub Actions), 8am–6pm Asia/Manila
- Review gate: **yes** — drafts require dashboard approval before sending (EmailLog gains `status: draft/approved/sent`)
- Takeover alert: email-to-self via Gmail API
- Sequence spacing: day 0 / 5 / 9 · Daily cap: 15 · Hot-lead threshold: score ≥ 5
- Suppression matches on import: skip + report (never insert)

## Phases

- [ ] **1. Project setup** — Next.js (TS) app, MongoDB connection, env config, hello-world deploy to Vercel to confirm hosting end to end.
  - Notes:
- [ ] **2. Data models** — Contact, Campaign, EmailLog (incl. draft/approved/sent status), Suppression + basic CRUD API routes.
  - Notes:
- [ ] **3. Contact import** — CSV upload + manual entry form, suppression checking (skip + report), lead source tagging, dedupe.
  - Notes:
- [ ] **4. Gmail OAuth + manual send test** — one-time local auth flow, store refresh token, send one test email to self.
  - Notes:
- [ ] **5. AI personalization** — Claude API call producing a draft from sample key points; test standalone before wiring to sending.
  - Notes:
- [ ] **6. Sequence engine + review gate** — cron endpoint (CRON_SECRET): reply-check → draft generation for due contacts → send approved drafts; stage advancement, daily cap, send window. Includes the draft review/approve queue (API + basic UI). Test with a fake contact and minutes-scale spacing.
  - Notes:
- [ ] **7. Open tracking pixel** — endpoint + pixel embed, confirm a hit logs.
  - Notes:
- [ ] **8. Link click tracking** — link rewriting + 302 redirect endpoint, confirm a click logs.
  - Notes:
- [ ] **9. Reply detection + suppression handling** — thread polling, opt-out keyword handling, status transitions.
  - Notes:
- [ ] **10. Pipeline stage automation** — auto-transitions on send/reply; manual stage controls in a basic UI.
  - Notes:
- [ ] **11. Engagement scoring** — +1/+3/+10 scoring tied to open/click/reply events; hot-leads filter (score ≥ 5).
  - Notes:
- [ ] **12. Human takeover alert** — email-to-self on reply, fired last in the reply-detection pass.
  - Notes:
- [ ] **13. Dashboard UI** — contacts table (filters/sort), campaign funnel, lead source breakdown, contact detail timeline, suppression list view.
  - Notes:
- [ ] **14. Production cron + real spacing** — day 0/5/9 spacing, set up the external hourly pinger against production, small real test batch before full volume.
  - Notes:

## Session Log

- **2026-07-04** — Project bootstrapped: SPEC.md copied in, CLAUDE.md and SESSION_NOTES.md created, spec open questions resolved by interview (see Decisions Locked). No code yet.

# ShikksTracker — UI Design Brief

## What This App Is

A single-user, self-hosted cold-email outreach tool built for a Philippine small business owner. It automates a 3-touch email sequence to cold contacts, lets the owner review and approve every draft before it sends, and alerts them the moment a prospect replies so they can take over personally.

The owner is the only user. There is no login screen. The app lives at a private Vercel URL.

---

## Tech Stack (for the designer's reference)

- Next.js (App Router) + TypeScript
- Tailwind CSS
- MongoDB Atlas

---

## Pages & Features

### 1. Dashboard — `/` (main contacts table)

The home base. Shows all contacts across all campaigns.

**What's on this page:**
- Contacts table with columns: Business Name, Contact Name, Email, Campaign, Pipeline Stage, Status, Lead Source, Engagement Score, Next Send date
- **Filters:** Campaign dropdown, Pipeline Stage dropdown, Status dropdown, Lead Source dropdown, "Hot leads only" toggle (score ≥ 5)
- **Sort:** by engagement score
- Each row links to the contact detail page
- Score ≥ 5 contacts are highlighted (hot leads)
- Per-contact stats shown inline (opens, clicks, stage sent)

**Key actions:**
- Navigate to contact detail
- Toggle hot leads filter
- Apply filters

---

### 2. Contact Detail — `/contacts/[id]`

Deep-dive on a single prospect.

**What's on this page:**
- Contact info header: Business Name, Contact Name, Email, Lead Source, Campaign, current Status, current Pipeline Stage, Engagement Score
- **Email timeline:** chronological list of all emails sent to this contact — each card shows stage (1/2/3), subject, body preview, sent date, open count, click count, reply status, and draft/approved/sent badge
- **Manual pipeline controls:** buttons to move to Call Booked → Proposal Sent → Won / Lost
- **Pause / Resume** button (pauses the sequence for this contact)
- **Key Points** field (the personalization notes fed to Claude for AI drafts)

---

### 3. Review Queue — `/review`

The human approval gate before any email is sent.

**What's on this page:**
- List of all email drafts pending approval (status = "draft")
- Each draft card shows: Business Name, Campaign, Stage (1st / 2nd / 3rd touch), Subject, full Body
- **Actions per draft:**
  - Edit subject or body inline
  - Approve (flips to "approved" → will send on next cron run)
  - Delete draft (discards it; contact stays active, sequence will regenerate next run)
- Empty state when no drafts are pending

**This is a critical workflow page** — the owner visits this daily to approve or tweak AI-generated emails before they go out.

---

### 4. Campaigns — `/campaigns`

Manage outreach campaigns and see funnel stats.

**What's on this page:**
- **Create campaign form:** Campaign Name, Offer Summary (fed to Claude), Tone Notes, Sequence Spacing (default: Day 0 / 5 / 9)
- **Campaign cards / list:** each shows:
  - Campaign name + date created
  - **Funnel bar:** contacts at each pipeline stage (Not Started → Contacted → Replied → Call Booked → Proposal Sent → Won / Lost)
  - **Pipeline breakdown table:** count per stage
  - **Lead source table:** breakdown of contacts by source (Cold Email, Referral, Event Connection, Other)

---

### 5. Import Contacts — `/import`

Bring contacts into the system.

**What's on this page:**
- **CSV upload:** drag-and-drop or file picker; accepted columns: businessName, contactEmail, contactName, keyPoints, leadSource, campaignId
- **Manual entry form:** single contact form with the same fields
- **Import summary:** after upload, shows counts — inserted / suppressed (already on suppression list) / duplicates / invalid
- Suppressed contacts are never inserted; the summary explains why each was skipped

---

### 6. Suppression List — `/suppressions`

The do-not-contact registry. PH Data Privacy Act compliance.

**What's on this page:**
- Search bar (filter by email)
- Table: Email, Reason (unsubscribed / bounced / manual), Date Added
- **Add manually:** input an email + reason to block it
- **Delete:** remove a suppression entry (use with care)
- Suppressions are checked on every import and before every send

---

## Data Concepts (helps design labels and empty states)

| Term | Meaning |
|---|---|
| Contact | A prospect business / person being outreached |
| Campaign | A named outreach effort with an offer + tone settings |
| Stage | Which email in the sequence (1st touch, 2nd follow-up, 3rd follow-up) |
| Pipeline Stage | Where the deal stands: Not Started → Contacted → Replied → Call Booked → Proposal Sent → Won / Lost |
| Engagement Score | Points accumulated: +1 open, +3 click, +10 reply |
| Hot Lead | Score ≥ 5 — these contacts get highlighted and can be filtered |
| Draft | AI-generated email waiting for human approval |
| Approved | Draft the owner has reviewed and cleared to send |
| Sent | Email delivered to Gmail |
| Suppressed | Email address blocked from ever receiving mail |
| Key Points | Short personalization notes about a contact fed to Claude to generate unique emails |

---

## Tone & Personality

- **Professional but personal** — this is a relationship-building tool, not a spam blaster
- **Single user, no clutter** — no multi-tenant complexity, no role management, no settings maze
- **Action-oriented** — the owner's daily job is: check review queue → approve drafts → check replies → move deals forward
- **Philippine context** — warm, relationship-first sales culture; the tool should feel helpful, not robotic

---

## Design Constraints

- Desktop-first (owner uses a laptop)
- Dark mode preferred (optional but preferred)
- Must feel like a focused sales tool, not a generic CRUD app
- The Review Queue page is the most important page — it should feel like the "command center"
- Hot leads (score ≥ 5) should be visually distinct everywhere they appear
- Pipeline stages should use color coding (e.g. green = Won, red = Lost, yellow = in progress)

---

## Navigation Structure

```
NavBar (persistent top or sidebar)
├── Dashboard (contacts table)
├── Review Queue  ← most important, badge with pending count
├── Campaigns
├── Import
└── Suppressions
```

---

## Key User Flows

**Daily workflow:**
1. Open Review Queue → read AI drafts → edit if needed → approve
2. Check Dashboard → filter hot leads → see who replied
3. On a reply: go to contact detail → move pipeline stage → log next step

**Onboarding a new campaign:**
1. Go to Campaigns → create campaign (name, offer, tone)
2. Go to Import → upload CSV of prospects
3. Wait for cron to generate drafts → approve in Review Queue
4. Watch the funnel fill up in Campaigns view

---

## What the App Does NOT Have (v1)

- No login / auth (single user, private URL)
- No mobile app
- No A/B testing
- No automated proposal generation
- No Telegram/ntfy alerts (email-to-self only for now)
- No multi-user / team features

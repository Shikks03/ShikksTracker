# Meta App Review — `pages_messaging` submission

> ## ⛔ CLOSED — 2026-09-05. This submission is NOT going ahead.
>
> Riku decided, finally and explicitly, **not to publish the Meta app.** App
> Review requires a verification step he cannot satisfy without a registered
> business, and the freelance work is a deliberate side thing he has no plans to
> register. **Do not re-raise this, and do not propose registration as a
> workaround.**
>
> Consequence: the app stays in **Development mode** permanently, webhook events
> fire only for accounts holding a role on it, and `/messenger` will only ever
> show Riku's own DMs. Prospect DMs are handled in Facebook's own Page inbox.
> The email engine, the phone/Instagram lanes and the `/api/os/*` contract are
> all unaffected — none of them touch Meta.
>
> **This file is kept as a record, not a to-do.** The answers below were drafted
> and are accurate; if Meta's requirements ever change, or the business is ever
> registered, the work is already done. Nothing here is pending.

Working notes and paste-ready answers for taking the **RikuOS** app
(App ID `1621042132722448`) from Development to Live.

Prepared 2026-09-05, after the Send API test call activated the
**Request Advanced Access** button — and closed the same day.

> **The single most important thing:** every answer below must stay true of the
> code. If the app later starts sending Facebook messages automatically, this
> submission becomes a false statement to Meta, not merely stale documentation.
> Today it does not: social and phone messages are AI-drafted, then **sent by
> hand by the operator**, who clicks "Mark sent". Only email is automated.

---

## 1. Verification

This is the section that decides the timeline. It asks who is building the app.

Read carefully whether it offers **individual verification** (government ID) or
demands **business verification** (registration documents — in the Philippines,
DTI or SEC). Riku operates as an unregistered freelancer trading as "Riku", so:

- If individual verification is offered, do that, with a government ID.
- If business verification is required, publishing is blocked until the business
  name is registered with DTI. That is a real fork in the road, not a formality
  to push through. Do not submit documents for an entity that does not exist.

---

## 2. App settings

Already complete as of 2026-09-04 — icon (1024x1024), category, contact email
`riku.mnl26@gmail.com`, app domain `shikkstracker.vercel.app`, and:

| Setting | Value |
|---|---|
| Privacy Policy URL | https://shikkstracker.vercel.app/privacy |
| Terms of Service URL | https://shikkstracker.vercel.app/terms |
| User data deletion | https://shikkstracker.vercel.app/data-deletion |

The **Required actions** tab was empty before submitting, which is the signal
this section is satisfied.

---

## 3. Allowed usage — what the permission is for

Paste-ready. Every sentence is verifiable in the code.

> This app is a private inbox for a single operator. It is not offered to the
> public and has no sign-up.
>
> `pages_messaging` is used for two things:
>
> 1. To receive webhook events for messages people send to our own Facebook
>    Page, so they appear in one place for the operator to read and answer.
> 2. To look up the sender's name for a message we have received, so the
>    conversation can be matched to the business record we already hold.
>
> The app does not send automated or bulk messages through the Send API. When
> the operator replies, they type the reply themselves in the Facebook Page
> inbox. The app's role is to make sure an incoming message is seen and
> answered by a person.

**Do not claim more than this.** Cold outreach on Messenger is against Platform
Policy, and describing the tool as an outreach system — which it is on the email
side — invites a rejection for the wrong reason. The Messenger lane genuinely
only reads.

---

## 4. Data handling

What Meta wants to know is where Platform Data goes and who can reach it.

> Messages and sender names received from the Page are stored in a MongoDB
> Atlas database used only by this application, and the application is hosted on
> Vercel. All traffic is encrypted in transit.
>
> Access is limited to one person, the operator, behind a password-protected
> login. There are no other user accounts and no third party has access.
> Platform Data is not sold, shared, or used for advertising, and is not sent to
> any other service.
>
> Data is retained while the conversation is active and is deleted on request.
> Deletion instructions are published at
> https://shikkstracker.vercel.app/data-deletion and requests are completed
> within 30 days.

One honest caveat to keep straight in your own head: business details are sent
to Anthropic's API to draft message text, which the privacy policy discloses.
That concerns **contact records**, not Platform Data received from Meta —
Messenger message content is not sent to Anthropic. Do not volunteer it in this
section, and do not deny it if asked; the accurate statement is that Platform
Data from Meta is not sent to third-party services.

---

## 5. Reviewer instructions — the hard part

A reviewer must be able to see the permission in use. The app is password-gated,
single-user, and its database holds **real personal data about real businesses**.

### The decision you have to make

Meta normally wants working credentials. Handing over `DASHBOARD_PASSWORD` gives
a stranger the live dashboard: real contacts, real reply text, and tooling wired
to a Gmail account that can send mail as you. That is a genuine privacy exposure
to the businesses in your database, not just a risk to you — and those
businesses never agreed to it.

**Recommended: lead with a screencast, offer credentials only if asked.**
Internal-tool submissions are commonly accepted on a video alone. Say plainly
that the app has no public sign-up and one operator account.

If Meta insists on credentials, the least-bad version is:

1. Rotate `DASHBOARD_PASSWORD` to a temporary value, and rotate `SESSION_SECRET`
   at the same time (that is the revocation lever — see CLAUDE.md).
2. Give them the temporary password.
3. Rotate both again the moment the review closes.

Even then the reviewer sees real data. There is no demo mode in this app; if one
is ever wanted, that is a build task, not a settings toggle.

### Paste-ready instructions

> This app has no public sign-up. It is an internal tool used by one person to
> read and answer messages sent to our own Facebook Page.
>
> A screencast is attached showing the full flow:
>
> 1. A person sends a message to our Facebook Page.
> 2. The message is received by our webhook and appears in the app's
>    conversation list, showing the sender's name and message.
> 3. The operator opens the conversation and reads the thread.
> 4. The operator matches the conversation to the business record we already
>    hold for that person, so past context is visible in one place.
> 5. The operator replies from the Facebook Page inbox. The reply appears in the
>    thread so the record stays complete.
>
> The permission is used only to receive these messages and to display the
> sender's name. No messages are sent automatically.

### Screencast checklist

Record in one take, no cuts, screen only. Show, in order:

- The Page receiving a message (phone, or a second window)
- `/messenger` — the conversation appearing, sender's name visible
- Opening the thread and reading it
- Linking it to a business record
- Replying from the Page inbox, and the reply landing back in the thread

Narrate what each step is for. Reviewers reject vagueness far more often than
they reject a modest use case.

---

## Common rejection causes worth pre-empting

| Cause | Guard |
|---|---|
| Vague use case | The wording in §3 is specific about what is read and why |
| Reviewer cannot see the feature | Screencast covering the whole loop, not fragments |
| Description implies unsolicited messaging | Never describe the Messenger lane as outreach — it only reads |
| Policy URLs unreachable | All three verified 200 logged-out on 2026-09-04 |
| Claims that do not match behaviour | Every claim here is checkable in the code; keep it that way |

---

## Aftermath

Approval grants Advanced Access to `pages_messaging`. **Publishing is still a
separate switch** — flip App Mode to Live at the top of the app dashboard. Until
then only accounts with a role on the app trigger webhooks, which is why a
non-role account's DM never arrived during P2 acceptance.

Also on the calendar: **2026-12-03**, when Meta's 90-day data-access window
lapses. After that `fetchDisplayName` starts returning `""` and every
conversation renders as `Unknown · <psid tail>` — silently, by design.

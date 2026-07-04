# Deployment Runbook

End-to-end checklist for going live. Work through the steps in order — each section depends on the previous one.

---

## 1. MongoDB Atlas

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and create a free account (or log in).
2. Create a new **free (M0) cluster**. Region does not matter for a single-user tool; Singapore is a reasonable choice.
3. Under **Security → Database Access**, create a database user with a strong password and the **Read and write to any database** role.
4. Under **Security → Network Access**, click **Add IP Address → Allow Access from Anywhere** (adds `0.0.0.0/0`). Vercel's outbound IPs are not fixed, so this is required on the free tier.
5. Under **Deployment → Database**, click **Connect → Drivers** and copy the connection string. Replace `<password>` with your database user's password. The string looks like:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/<dbname>?retryWrites=true&w=majority
   ```
   Use any short name for `<dbname>` (e.g. `shikkstracker`).

---

## 2. Vercel

1. Push the repo to GitHub (or GitLab / Bitbucket).
2. Go to [vercel.com](https://vercel.com), click **Add New → Project**, and import the repo.
3. Framework preset is detected as **Next.js** — leave all build settings at default.
4. Before clicking **Deploy**, open **Environment Variables** and add every required variable:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Connection string from step 1 |
   | `GOOGLE_CLIENT_ID` | From Google Cloud Console |
   | `GOOGLE_CLIENT_SECRET` | From Google Cloud Console |
   | `GOOGLE_REFRESH_TOKEN` | Obtained during local OAuth flow (see `docs/gmail-setup.md`) |
   | `ANTHROPIC_API_KEY` | From [console.anthropic.com](https://console.anthropic.com) |
   | `APP_BASE_URL` | Your production URL, e.g. `https://shikkstracker.vercel.app` (no trailing slash) |
   | `CRON_SECRET` | A long random string — keep this secret; it protects the sequence engine endpoint |
   | `NTFY_TOPIC_URL` | Optional — leave blank unless you want ntfy alerts |
   | `TELEGRAM_BOT_TOKEN` | Optional — leave blank unless you want Telegram alerts |
   | `TELEGRAM_CHAT_ID` | Optional — leave blank unless you want Telegram alerts |

   Optional tuning variables (defaults are safe to omit initially):

   | Variable | Default | Notes |
   |---|---|---|
   | `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude model for draft generation |
   | `DAILY_SEND_CAP` | `15` | Hard ceiling on emails sent per Manila calendar day |
   | `SENDS_PER_RUN` | `3` | Max sends per cron invocation |
   | `DRAFTS_PER_RUN` | `10` | Max drafts generated per cron invocation |
   | `SEND_DELAY_MIN_MS` | `30000` | Min delay between sends in a single run (ms) |
   | `SEND_DELAY_MAX_MS` | `60000` | Max delay between sends in a single run (ms) |
   | `HOT_LEAD_THRESHOLD` | `5` | Engagement score at which a contact is flagged as a hot lead |

5. Click **Deploy**.
6. **Note:** Vercel applies environment variable changes only after a redeploy. If you add or update a variable later, trigger a redeploy from the Vercel dashboard (Deployments → Redeploy).

---

## 3. Gmail OAuth — Production Redirect URI

The refresh token you obtained locally works in production (it is tied to the OAuth client, not the redirect URI). However, the production domain must be listed as an authorised redirect URI in the Google OAuth client — otherwise the flow will fail for any future token refresh attempts or re-authorisation.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → **APIs & Services → Credentials**.
2. Click your OAuth 2.0 Client ID.
3. Under **Authorised redirect URIs**, add:
   ```
   https://<your-production-domain>/api/auth/gmail/callback
   ```
4. Click **Save**.

Full Gmail OAuth instructions: `docs/gmail-setup.md`.

---

## 4. Smoke Tests in Production

Run these from PowerShell after the first deploy. Replace `<domain>` and `<secret>` with your values.

**Health check — confirm DB is connected:**

```powershell
Invoke-WebRequest -Uri "https://<domain>/api/health" | Select-Object -ExpandProperty Content
```

Expected response: `{"ok":true,"db":"connected"}`

**Test send — sends an email to yourself:**

```powershell
Invoke-WebRequest -Method POST `
  -Uri "https://<domain>/api/test/send-self" `
  -Headers @{ "x-cron-secret" = "<secret>" }
```

Expected response: `{"messageId":"...","threadId":"..."}`  
Check your inbox for a message with subject **"Outreach tool test send"**.

**Test draft generation (inline mode — no DB contact required):**

```powershell
$body = '{"offerSummary":"We build websites for SMEs","businessName":"Acme Corp","keyPoints":"They have no website","stage":1}'
Invoke-WebRequest -Method POST `
  -Uri "https://<domain>/api/test/generate-draft" `
  -Headers @{ "x-cron-secret" = "<secret>"; "Content-Type" = "application/json" } `
  -Body $body
```

Expected response: `{"subject":"...","body":"...","html":"..."}`

---

## 5. Hourly Pinger

Set up the external cron pinger **after** smoke tests pass. The sequence engine will not send anything without it.

The app's send window is **08:00–18:00 Asia/Manila**, which is **00:00–10:00 UTC**. Set the pinger to fire at the top of each hour for UTC hours 0–9 (inclusive).

Full setup instructions for cron-job.org and GitHub Actions: `docs/cron-setup.md`.

---

## 6. Warm-Up Guidance

Gmail accounts that suddenly start sending bulk cold email get flagged as spam. Ramp up gradually:

1. **Keep `DAILY_SEND_CAP=15` (or lower) for the first few weeks.** Increase it only after your open rates and bounce rates look healthy.
2. **Run your first real batch with a small test campaign** — 3–5 contacts that include yourself and a friend or two. Verify:
   - Emails arrive in inbox (not spam).
   - The tracking pixel increments the open count when you open the email.
   - Clicking a tracked link registers in the email log.
   - Replying triggers reply detection (check in the next cron run), stops the sequence, and fires the takeover alert to your inbox.
3. **Only after the above works end-to-end**, import your real prospect list and launch a production campaign.
4. Watch bounce rates. If a send bounces, the contact status is set to `bounced` and no further emails are sent to that address.

---

## 7. Compliance (PH Data Privacy Act)

- Send to **business email addresses only** — the tool is designed for B2B outreach, not personal Gmail/Yahoo addresses.
- The suppression list is checked automatically on CSV import and before every send. Unsubscribed contacts are never emailed again.
- Every email generated by the AI includes an opt-out line (e.g. "Reply STOP to be removed"). Confirm this is present in your drafts before approving them in the review queue.
- You are the data controller for any contact data stored in MongoDB Atlas. Do not store more personal information than is necessary for the outreach (business name, contact name, email, and your personalization notes).

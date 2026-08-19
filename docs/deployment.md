# Deployment Runbook

End-to-end checklist for going live. Work through the steps in order — each section depends on the previous one.

---

## 1. MongoDB Atlas

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and create a free account (or log in).
2. Create a new **free (M0) cluster**. Region does not matter for a single-user tool; Singapore is a reasonable choice.
3. Under **Security → Database Access**, create a database user with a strong, unique password. Assign the built-in role **readWrite** scoped to your app database only (select "Restrict access to specific databases" and enter the same `<dbname>` you use in the connection string, e.g. `shikkstracker`). Do **not** use the "Read and write to any database" cluster-wide role.
4. Under **Security → Network Access**, click **Add IP Address → Allow Access from Anywhere** (adds `0.0.0.0/0`). Vercel's outbound IPs are not fixed, so this is required on the free tier. Compensate by using a long, unique database password (see step 3).
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
   | `DASHBOARD_PASSWORD` | A strong password for the dashboard login page. **Minimum 12 characters** — the app returns 503 if unset or shorter |
   | `SESSION_SECRET` | **Required.** Random, **minimum 32 characters**, and **must be different from `DASHBOARD_PASSWORD`**. See the warning below |
   | `NTFY_TOPIC_URL` | Optional — leave blank unless you want ntfy alerts |
   | `TELEGRAM_BOT_TOKEN` | Optional — leave blank unless you want Telegram alerts |
   | `TELEGRAM_CHAT_ID` | Optional — leave blank unless you want Telegram alerts |

   > ### ⚠️ `SESSION_SECRET` — set this BEFORE you deploy
   >
   > The session cookie is signed with `SESSION_SECRET`. It is deliberately **not** derived from
   > `DASHBOARD_PASSWORD`: it used to be, and that made every issued cookie an offline
   > password-cracking oracle (one SHA-256 per guess, no salt) — fixed 2026-07-31.
   >
   > - **If it is missing or under 32 chars, the whole dashboard returns 503.** Add it to Vercel
   >   *before* promoting the deploy, not after.
   > - **This deploy invalidates every existing session.** The old cookie format is rejected
   >   outright, so you will be logged out and must log in again. That is expected.
   > - Generate one with PowerShell:
   >   ```powershell
   >   -join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
   >   ```
   > - **Rotating `SESSION_SECRET` is how you revoke sessions.** There is no server-side session
   >   store, so `POST /api/auth/logout` only clears the cookie in *that* browser. If a cookie
   >   leaks or a device is lost, rotate this value and redeploy — every session dies immediately.
   > - Rotating `DASHBOARD_PASSWORD` alone does **not** log anyone out any more.

   > ### ⚠️ `APP_BASE_URL` must exactly match your real origin
   >
   > Mutating requests (POST/PATCH/DELETE) are now rejected with **403** if the browser's `Origin`
   > header does not match `APP_BASE_URL`. If you set it to the wrong host, or leave a trailing
   > slash mismatch, or later add a custom domain and forget to update this, the dashboard will
   > load fine and read fine but **every save, send, import and delete will fail with 403**.
   > If you serve the app on more than one hostname, they must agree on one canonical origin.

   **Sensitive variables:** Mark `MONGODB_URI`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `DASHBOARD_PASSWORD`, and `SESSION_SECRET` as **Sensitive** in the Vercel dashboard (the eye-slash icon — makes them write-only so they cannot be read back) and scope them to **Production** only. `GOOGLE_CLIENT_ID` and `APP_BASE_URL` are not secret and can remain readable.

   Optional tuning variables (defaults are safe to omit initially):

   | Variable | Default | Notes |
   |---|---|---|
   | `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude model for draft generation |
   | `DAILY_SEND_CAP` | `15` | Hard ceiling on emails sent per Manila calendar day |
   | `SENDS_PER_RUN` | `1` | Max sends per cron invocation. Default is 1 for Vercel Hobby safety (no inter-send sleep in the cron path; the hourly pinger spreads throughput). Raise only on a Vercel plan that guarantees function durations longer than 60 s. |
   | `DRAFTS_PER_RUN` | `10` | Max drafts generated per cron invocation |
   | `HOT_LEAD_THRESHOLD` | `5` | Engagement score at which a contact is flagged as a hot lead |
   | `SEND_BATCH_MAX` | `5` | Max approved logs per `/api/send-batch` request. The review UI chunks larger selections automatically and spaces them 1.5–4 s apart client-side. Keep at 5 on Vercel Hobby to stay well within the 60 s function limit. |

5. Click **Deploy**.
6. **Note:** Vercel applies environment variable changes only after a redeploy. If you add or update a variable later, trigger a redeploy from the Vercel dashboard (Deployments → Redeploy).

> **Full secrets checklist** (OAuth publishing status, key scoping, spend caps, and rotation runbook): see the local, untracked `CLAUDE.md` § *Secrets & Deployment Security Checklist*.

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

Opening `https://<domain>` in a browser will redirect to `/login` — enter `DASHBOARD_PASSWORD` to access the dashboard.

**Health check — confirm DB is connected:**

```powershell
Invoke-WebRequest -Uri "https://<domain>/api/health" | Select-Object -ExpandProperty Content
```

Expected response: `{"ok":true,"db":"connected"}`

If the database is unreachable the response is `{"ok":false,"db":"error"}` with HTTP 503.

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
4. Watch bounce rates. Bounces are detected two ways: (a) **at send time**, when the Gmail API rejects a clearly invalid recipient address, and (b) **at poll time**, when a `mailer-daemon@`/`postmaster@` bounce notification naming the contact's address appears in the thread (this second layer can be disabled with `BOUNCE_POLL_DETECTION=false` if it proves noisy). On either signal the contact's status is set to `bounced`, its address is added to the suppression list, any pending drafts are removed, and no further emails are sent to that address. Detection is deliberately conservative — ambiguous send errors (quota, auth, transient failures) are retried, not treated as bounces.

---

## 7. Compliance (PH Data Privacy Act)

- Send to **business email addresses only** — the tool is designed for B2B outreach, not personal Gmail/Yahoo addresses.
- The suppression list is checked automatically at three points: on CSV import, at draft generation, and again at send time (an address added to the suppression list mid-sequence is honored on the next run — its contact is unsubscribed and pending drafts are removed before anything sends). A manual status change to `unsubscribed` or `bounced` on the contact page also adds the address to the suppression list, so it survives a future re-import. Unsubscribed contacts are never emailed again.
- Opt-out replies are detected conservatively: an incoming reply is treated as an opt-out only when the whole message is a clear command (`STOP`, `unsubscribe`, `opt out`) or contains an explicit opt-out phrase (`remove me`, `please unsubscribe`, `stop emailing me`, etc.). A bare "stop" used mid-sentence is treated as a normal reply so it reaches you via the takeover alert rather than silently unsubscribing an interested lead. Every opt-out (and every bounce) also fires a takeover alert so you can audit for misfires.
- Every email generated by the AI includes an opt-out line (e.g. "Reply STOP to be removed"). Confirm this is present in your drafts before approving them in the review queue.
- You are the data controller for any contact data stored in MongoDB Atlas. Do not store more personal information than is necessary for the outreach (business name, contact name, email, and your personalization notes).

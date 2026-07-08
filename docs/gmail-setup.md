# Gmail OAuth Setup

This guide walks through configuring Google OAuth so the outreach tool can send emails via Gmail on your behalf.

## Prerequisites

- A Google account (the one you want to send from)
- The dev server running locally (`npm run dev`)

---

## Step 1 — Create a Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project selector at the top → **New Project**
3. Give it a name (e.g. `ShikksTracker`) and click **Create**
4. Make sure the new project is selected in the top bar

---

## Step 2 — Enable the Gmail API

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for **Gmail API**
3. Click it and press **Enable**

---

## Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** and click **Create**
3. Fill in required fields:
   - App name: `ShikksTracker` (or anything)
   - User support email: your email
   - Developer contact information: your email
4. Click **Save and Continue** through the Scopes screen (no changes needed)
5. On the **Test users** screen, click **Add users** and enter your Gmail address
6. Click **Save and Continue**, then **Back to Dashboard**

> The app stays in "Testing" mode — only listed test users can authorise it. This is fine for single-user personal use.

---

## Step 4 — Create an OAuth 2.0 Client

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `ShikksTracker Web`
5. Under **Authorised redirect URIs**, add both:
   - `http://localhost:3000/api/auth/gmail/callback` (development)
   - `https://<your-production-domain>/api/auth/gmail/callback` (production, when ready)
6. Click **Create**
7. A dialog shows your **Client ID** and **Client Secret** — copy both

---

## Step 5 — Fill in Environment Variables

Open `.env.local` (create it at the project root if it doesn't exist) and add:

```
GOOGLE_CLIENT_ID=<paste Client ID here>
GOOGLE_CLIENT_SECRET=<paste Client Secret here>
APP_BASE_URL=http://localhost:3000
CRON_SECRET=<choose a long random string, e.g. output of: openssl rand -hex 32>
```

Leave `GOOGLE_REFRESH_TOKEN` empty for now.

---

## Step 6 — Start the Dev Server

```powershell
npm run dev
```

---

## Step 7 — Run the OAuth Flow

> **Local development only.** The `/api/auth/gmail` bootstrap routes are intended to be run locally. In production they return 404 unless the environment variable `ALLOW_OAUTH_BOOTSTRAP=true` is set temporarily. Never leave that variable set in a permanent deployment — remove it (or set it to any other value) and redeploy once you have the refresh token.

1. Open your browser and navigate to:
   ```
   http://localhost:3000/api/auth/gmail
   ```
2. You will be redirected to Google's consent screen
3. Sign in with the test user account you added in Step 3
4. Grant the requested permissions (Send email, Read email)
5. You will be redirected back to the callback page, which displays your **refresh token**

---

## Step 8 — Save the Refresh Token

1. Copy the entire value shown under `GOOGLE_REFRESH_TOKEN`
2. Add it to `.env.local`:
   ```
   GOOGLE_REFRESH_TOKEN=<paste refresh token here>
   ```
3. **Stop and restart** the dev server so it picks up the new variable

---

## Step 9 — Verify the Integration

Run the test-send endpoint from PowerShell:

```powershell
Invoke-WebRequest -Method POST -Uri http://localhost:3000/api/test/send-self -Headers @{"x-cron-secret"="<your CRON_SECRET>"}
```

A successful response looks like:

```json
{"messageId":"18c...","threadId":"18c..."}
```

Check your inbox — you should have received an email with the subject **"Outreach tool test send"**.

---

## Troubleshooting

### No refresh token in callback response
You previously granted consent to this OAuth client. Revoke it:
1. Go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Find the app and click **Remove access**
3. Re-visit `/api/auth/gmail` and complete the flow again

### 401 from test-send endpoint
Check that the `x-cron-secret` header value exactly matches `CRON_SECRET` in `.env.local` (no trailing spaces, same case).

### 500 from any endpoint
Check that all four env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `APP_BASE_URL`) are set and the dev server was restarted after editing `.env.local`.

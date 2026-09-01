# Meta app setup — Messenger webhook (P2, Feature A)

Manual, one-time setup on **your** Facebook developer account. This is roadmap task
**2.1**; the code (2.2–2.6) is useless without it.

Design source: `docs/superpowers/specs/2026-08-28-rikuos-step1-messenger-api-variants-design.md` §A.1.

---

## The one thing to understand before you start

**You cannot finish this in one sitting, and that is not a mistake you made.**

Meta will not accept a webhook subscription until it can reach a live URL that answers
its verification challenge. That URL is
`https://shikkstracker.vercel.app/api/webhooks/messenger`, and **it does not exist
yet** — it ships with this phase's code.

So the work splits cleanly:

| | What | Blocked on |
|---|---|---|
| **Part 1** | Create the app, get the three secrets, put them in env | nothing — **do this now** |
| **Part 2** | Point Meta at the webhook URL and subscribe the page | the endpoint being deployed |

Do Part 1 today. Part 2 takes about four minutes once the deploy is up.

A dev-mode app is all that is needed. No app review, no business verification — those
are required to message people who have *not* messaged you, and this app never does
that (spec D2: no cold-send automation, ever). You admin the RIKU page, so you are
already permitted to receive its messages.

---

## Part 1 — do this now

### 0. Register RIKU as a Meta developer (one-time, must be you)

Checked 2026-08-30: the RIKU Facebook account is logged in but is **not** a registered
developer, so <https://developers.facebook.com/apps/> silently bounces to the marketing
homepage. There is nothing wrong — the app list does not exist until the account is
registered.

1. Go to <https://developers.facebook.com/settings/developer/>.
2. **Register Now** → accept Meta's Platform Terms and Developer Policies.
3. Expect a phone or email confirmation code.

This step is yours specifically: it is a legal acceptance under your name and a
verification code sent to your device. Everything after it is ordinary configuration.

### 1. Create the app

1. Go to <https://developers.facebook.com/apps/> and log in as the account that
   **admins the RIKU page**.
2. **Create app**.
3. App name: `ShikksTracker Messenger` (anything; only you see it). Contact email: yours.
4. When asked what you want your app to do, pick the option about **messaging /
   managing messages on a Page**. If you only see the older app-type picker, choose
   **Business**.
5. Create it. You will land on the app dashboard.

> If you already made an app for this, use it — skip to step 2. Two apps subscribed to
> the same page both receive every event, which means duplicate webhook deliveries.

### 2. Add the Messenger product

On the app dashboard, find **Messenger** in the product list and **Set up**. This adds
a **Messenger → Settings** entry to the left sidebar. Everything below lives there.

### 3. Connect the RIKU page and generate the page access token

In **Messenger → Settings**, find the **Access tokens** panel.

1. **Add or remove pages** → log in → select **RIKU** → grant the requested permissions
   (they will include `pages_messaging` and `pages_manage_metadata`).
2. RIKU now appears in the table. Click **Generate token**.
3. Copy it. This is `META_PAGE_TOKEN`.

**Copy it now — Meta shows it exactly once**, and re-generating invalidates the old one.

> **Expiry, and why it matters.** A token generated in this panel is derived from your
> browser login and can expire — typically in about 60 days, sooner if you change your
> Facebook password or revoke the app. When it dies, inbound Messenger events stop
> arriving silently. That is the *expected* failure mode for a dev-mode app, and it is
> exactly what RikuOS's watchdog is built to catch (roadmap P5, task 5.1 — it alarms on
> a stale `lastEventAt`). If it ever fires, come back to this step and re-generate.
>
> There is a durable alternative — exchanging a long-lived user token for a
> non-expiring page token via the Graph API — but it is fiddly and buys little here
> given the watchdog exists. Take the console token; treat re-generation as routine
> maintenance, not an incident.

### 4. Grab the app secret

**App settings → Basic** (left sidebar, near the bottom) → **App secret** → **Show** →
re-enter your password → copy.

This is `META_APP_SECRET`. It is the key every inbound webhook request is signed with —
it is what stops anyone who guesses the URL from injecting fake Messenger replies into
your pipeline. Treat it like `SESSION_SECRET`.

### 5. Invent a verify token

`META_VERIFY_TOKEN` is not issued by Meta — you make it up. It is a shared password used
once, during the handshake in Part 2, to prove that the person configuring the webhook
is you.

Generate one (PowerShell):

```powershell
-join ((1..32) | % { '{0:x2}' -f (Get-Random -Max 256) })
```

Keep it somewhere you can paste from in Part 2.

### 6. Put all three in env

**Local** — append to `.env.local`:

```
META_APP_SECRET=<from step 4>
META_VERIFY_TOKEN=<from step 5>
META_PAGE_TOKEN=<from step 3>
```

**Vercel** — for each of the three:

```powershell
npx vercel env add META_APP_SECRET production
npx vercel env add META_VERIFY_TOKEN production
npx vercel env add META_PAGE_TOKEN production
```

Paste the value when prompted. All three are **secrets** — mark them Sensitive and scope
them to **Production**, per the checklist in `CLAUDE.md` §A.4. Env changes need a
redeploy to take effect; the deploy that ships the webhook code covers that.

**Part 1 is done.** Tell me when the three values are in Vercel and I will deploy.

---

## Part 2 — after the webhook endpoint is deployed

Do not start this until the deploy is live. Meta's verification is a real HTTP request;
if the route 404s, the console shows a generic failure that tells you nothing.

### 7. Point Meta at the webhook

**Messenger → Settings → Webhooks** → **Add callback URL**.

| Field | Value |
|---|---|
| Callback URL | `https://shikkstracker.vercel.app/api/webhooks/messenger` |
| Verify token | the value from step 5 |

**Verify and save.** Meta immediately sends a `GET` carrying `hub.mode=subscribe`,
`hub.verify_token` and `hub.challenge`; the endpoint compares the token (timing-safe)
and echoes the challenge back. Success is instant and silent — the dialog just closes.

**If it fails**, check in this order:

1. `META_VERIFY_TOKEN` in **Vercel** matches what you typed — not the one in
   `.env.local`. These are easy to skew apart.
2. You redeployed *after* adding the env vars. Vercel does not hot-reload them.
3. `curl https://shikkstracker.vercel.app/api/webhooks/messenger` returns something
   other than a 404.

### 8. Subscribe the page to the right fields

Two separate things live under Webhooks and it is easy to do only the first:

1. **Webhook fields** — **Manage** next to the Page subscription → tick **`messages`**
   and **`message_echoes`** → save.
2. **Page subscription** — in the **Access tokens** panel, the RIKU row has its own
   subscribe control. **The page itself must be subscribed to the app.** Ticking fields
   at the app level does nothing on its own, and this is the single most common reason a
   correctly-verified webhook then receives no events.

Why those two fields:

- `messages` — someone messages the RIKU page. This is the whole point: it becomes an
  inbound message on `/messenger` and marks the contact replied.
- `message_echoes` — a copy of what the *page* sends, including messages you type by
  hand in the Meta inbox from your phone. Without it, replying from your phone is
  invisible to the app and the conversation looks permanently unanswered.

### 9. Confirm it works

Message the RIKU page **from a different Facebook account** (your own account messaging
your own page does not reliably generate an event).

Within a minute it should appear in `/messenger`. That is the phase's acceptance
criterion, so this is the real test, not a formality.

If nothing arrives: Meta logs every delivery attempt and its response under
**Messenger → Settings → Webhooks → recent deliveries**. Check there before assuming the
app is at fault — a 401 there means a signature mismatch (wrong `META_APP_SECRET`), and
no delivery attempt at all means step 8's page subscription did not take.

---

## Notes

- **Dev mode is the end state, not a stepping stone.** Do not submit for app review.
  Review exists to let an app message strangers; receiving messages sent *to* a page you
  admin needs none of it, and going through review would invite scrutiny of a permission
  set this app deliberately does not want.
- **Instagram is out of scope** (spec non-goals). IG DM webhooks need the professional
  account linked to the page and a different permission set. `/outreach` keeps handling
  Instagram by hand.
- **If a secret leaks**, rotate it the same way as everything else in `CLAUDE.md` §B:
  app secret → **App settings → Basic → Reset**; page token → **Generate token** again
  (this invalidates the old one); verify token → change it in both Vercel and the Meta
  console, in that order.

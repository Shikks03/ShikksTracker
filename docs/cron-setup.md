# Cron Setup Guide

> **Status (2026-08-30):** the pinger described here is now committed as
> `.github/workflows/sequence-pinger.yml`. Before that it had never existed —
> production reported `engine.lastRunAt = 2026-08-01` and no `.github/`
> directory was present, meaning nothing had called the engine for 29 days.
> One manual step remains: **add the `CRON_SECRET` repository secret** (below).

## Endpoint

```
GET|POST /api/cron/sequence
```

Required header:

```
x-cron-secret: <your CRON_SECRET value>
```

Both `GET` and `POST` are accepted (external pingers vary). The route is guarded:
requests without the correct secret receive `401`. The secret must go in the
**header**, never the query string — query strings end up in access logs.

## What one run actually does

`runSequenceEngine()` (`src/lib/sequence.ts`), in order:

| Step | Gate |
|---|---|
| 0. Sweep logs stuck in `"sending"` | always |
| A. Check replies, fire takeover alerts | always |
| B. Generate AI drafts | only if `/settings` → **draft generation** is on |
| C. Send approved logs | only if `/settings` → **sending** is on |

Both toggles live in the `Settings` document and **default to `false`**. So
enabling the pinger on its own cannot send a single email — it restarts reply
detection, and nothing else, until those switches are flipped in the UI.

---

## Scheduling: GitHub Actions (in use)

`.github/workflows/sequence-pinger.yml`. Runs `5 0-10 * * *` UTC — hourly at
:05 from 08:05 to 18:05 Asia/Manila, which is a fixed UTC+8 with no DST.

**To activate it:**

1. Repo **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `CRON_SECRET`
   - Value: the same 48-character value as `CRON_SECRET` in Vercel
2. Optionally add a repository **variable** `APP_BASE_URL` if the production
   URL ever changes; otherwise it defaults to `https://shikkstracker.vercel.app`.
3. Merge the workflow to the **default branch**.

**Three things about GitHub Actions schedules that bite people:**

- `schedule:` triggers **only ever run on the default branch.** A workflow file
  sitting on a feature branch is completely inert, however correct it is.
- GitHub **disables scheduled workflows in a repository with no activity for 60
  days**, and emails the owner. A quiet repo silently stops pinging.
- Scheduled runs are best-effort and can be **delayed by 15+ minutes** or
  dropped entirely under platform load. The engine is designed for this: work
  it misses is simply picked up by the next run.

The workflow deliberately does **not** use `curl --retry`. Retrying after a
timeout would re-enter an engine run that may already be mid-send; the engine
does defend itself (atomic `approved → "sending"` claim plus a stale-sending
sweep), but waiting for the next hourly run is the cheaper and safer answer.

`workflow_dispatch` is enabled for manual runs — note that a manual run is a
**real** engine run, not a dry run.

---

## Alternative: cron-job.org

Equivalent, if you would rather not use Actions (the tradeoff is that a third
party then holds your `CRON_SECRET`):

1. Log in at [cron-job.org](https://cron-job.org).
2. Create a job:
   - **URL:** `https://<your-domain>/api/cron/sequence`
   - **Schedule:** minute `:05`, hours `0-10` **UTC** (= 08:00–18:00 Manila).
   - **Custom headers:** `x-cron-secret` → `<your CRON_SECRET>`.
3. Save. cron-job.org supports custom headers natively.

Run **one** pinger, not both.

---

## Daily cap vs. runs-per-day relationship

| Variable | Default | Description |
|---|---|---|
| `DAILY_SEND_CAP` | 15 | Maximum emails sent in one Manila calendar day |
| `SENDS_PER_RUN` | 1 | Maximum emails sent per cron invocation |
| `DRAFTS_PER_RUN` | 10 | Maximum AI drafts generated per cron invocation |

`SENDS_PER_RUN` defaults to **1**, not 3 — lowered by Task 4.2 so a single run
finishes comfortably inside Vercel Hobby's function timeout with no inter-send
sleep in the cron path.

With 11 runs/day at `SENDS_PER_RUN=1`, the engine attempts at most 11 sends/day,
already under the `DAILY_SEND_CAP=15` ceiling. The cap is a Gmail
deliverability/warm-up budget and is enforced regardless of how many runs fire.
Raise `SENDS_PER_RUN` only on a plan with a longer function duration.

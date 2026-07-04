# Cron Setup Guide

## Endpoint

```
GET /api/cron/sequence
```

Required header:

```
x-cron-secret: <your CRON_SECRET value>
```

Both `GET` and `POST` are accepted (external pingers vary). The route is guarded:
requests without the correct secret receive `401`.

---

## Scheduling: cron-job.org (recommended)

1. Log in at [cron-job.org](https://cron-job.org).
2. Create a new job:
   - **URL:** `https://<your-domain>/api/cron/sequence`
   - **Schedule:** every hour, limited to hours 08–17 (server time = UTC). Since
     the app's send window is **08:00–18:00 Asia/Manila (UTC+8)**, the equivalent
     UTC range is **00:00–10:00 UTC**. Set the job to run at minute `:00` for hours
     `0,1,2,3,4,5,6,7,8,9` UTC.
   - **Custom headers:** add `x-cron-secret` → `<your CRON_SECRET>`.
3. Save. cron-job.org supports custom headers natively.

---

## Scheduling: GitHub Actions

```yaml
name: Sequence Engine Cron

on:
  schedule:
    # Every hour 00:00–09:00 UTC = 08:00–17:00 Asia/Manila
    - cron: "0 0-9 * * *"
  workflow_dispatch:

jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Ping sequence engine
        run: |
          curl -f -X GET \
            -H "x-cron-secret: ${{ secrets.CRON_SECRET }}" \
            "https://<your-domain>/api/cron/sequence"
```

Store `CRON_SECRET` as a GitHub repository secret (`Settings → Secrets and variables → Actions`).

---

## Daily cap vs. runs-per-day relationship

| Variable | Default | Description |
|---|---|---|
| `DAILY_SEND_CAP` | 15 | Maximum emails sent in one Manila calendar day |
| `SENDS_PER_RUN` | 3 | Maximum emails sent per cron invocation |

With the default hourly schedule (10 runs/day) and `SENDS_PER_RUN=3`, the engine
could theoretically send up to 30 emails/day — but `DAILY_SEND_CAP=15` acts as the
hard ceiling regardless of how many runs fire. Adjust `SENDS_PER_RUN` to spread
sends more evenly across the day (e.g. `SENDS_PER_RUN=2` with 10 runs = at most 20
attempts capped at 15 actual sends).

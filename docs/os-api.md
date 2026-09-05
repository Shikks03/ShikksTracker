# `/api/os/*` — the RikuOS contract

Server-to-server API consumed by the RikuOS app in `../RikuOS`. Design source:
`docs/superpowers/specs/2026-08-28-rikuos-step1-messenger-api-variants-design.md` §D.

**These four response shapes are a compatibility surface.** Changing one obliges a
matching edit to `../RikuOS/ARCHITECTURE.md` §4.1 in the same change. Internal
schema may change freely; these shapes may not.

## Auth

Every route requires the header `x-os-secret: $OS_API_SECRET`. The secret must be
at least 32 characters. The routes fail closed with **503** when it is unset or
shorter than that, and **401** on a mismatch (timing-safe compare — both sides are
SHA-256'd first so a length mismatch is a 401, not a throw).

`/api/os/*` is session-exempt in `src/proxy.ts`, the same arrangement as
`/api/cron/*` with `x-cron-secret`. Session-exempt is not unguarded: every handler
calls `requireOsSecret()` as its first statement.

No CSRF Origin check applies here, and none is needed. CSRF exists because a
browser attaches an ambient credential (the session cookie) automatically; there
is no ambient credential on this surface, since the caller must set the header
explicitly.

## Endpoints

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/api/os/summary` | `limit` (default 50, max 200) | `limit` bounds the `campaigns` array only. |
| GET | `/api/os/attention` | `days` (default 3, max 365), `limit` (default 50, max 200) | |
| GET | `/api/os/variant-stats` | — | One row per Variant; deliberately not truncated. |
| POST | `/api/os/drafts` | — | Creates one `approved` log. |

### GET /api/os/summary

```jsonc
{
  "contacts": {
    "total": 0,
    "byPipelineStage": { "not_started": 0, "contacted": 0, "replied": 0, "call_booked": 0, "proposal_sent": 0, "won": 0, "lost": 0 },
    "hot": 0
  },
  "queue": { "drafts": 0, "approved": 0 },
  "campaigns": [ { "id": "", "name": "", "sent": 0, "opened": 0, "clicked": 0, "replied": 0 } ],
  "engine": { "lastRunAt": null, "lastRunErrors": 0 }
}
```

`campaigns` counts **contacts** with at least one sent / opened / clicked /
replied log — not raw log counts. This deliberately matches
`GET /api/campaigns/[id]/stats`, so the number RikuOS reports and the number the
dashboard shows can never disagree.

`hot` uses the server-side `HOT_LEAD_THRESHOLD` (default 5), the same variable
the `?hot=true` contact filter reads.

### RIP — the `messenger` block (2026-08-30 to 2026-09-05)

`GET /api/os/summary` used to return a fourth block:

```json
"messenger": { "lastEventAt": null, "unlinkedCount": 0, "unansweredCount": 0 }
```

**It is gone, along with the entire inbound Facebook Messenger lane** (decision
S15; RikuOS `ARCHITECTURE.md` §7). Removed here in `cb3d2d7` and finished once
RikuOS confirmed in `356197f`. **Do not add it back**, and do not treat its
absence as a bug or an outage.

**Why the lane went, in one line:** the Meta app will never be published, so it
stays in Development mode, where webhook events fire only for accounts holding a
role on the app. No prospect message could ever arrive. Every counter here was
structurally empty rather than merely zero.

**Two lessons this block earned, worth more than the code was:**

1. **A confident sentence in a contract doc becomes a hard-coded constant
   downstream.** This file used to say the Page "receives a handful of messages
   a week" and that staleness was "a legitimate alarm condition". RikuOS
   reasonably believed it and derived `WEBHOOK_SILENT_DAYS = 10` in its daily
   health check. Neither file was wrong when written. That is exactly the
   problem — and it is why this section is a gravestone rather than a clean
   deletion.

2. **Removing a dead signal can make things worse, not better.** RikuOS's
   `readStamp` mapped a MISSING block to `null`, and `null` was its
   "webhook never fired" alarm. Deleting this block before RikuOS deleted its
   consumer would have swapped "Messenger webhook silent for N days" for
   "ShikksTracker reports no Messenger event, ever" — **same daily noise,
   different sentence**. The alarm would have survived the fix meant to remove
   it. The removal was therefore ordered: consumer first, producer second, with
   an explicit handshake between them.

Still true and unaffected: `"facebook"` remains a valid `outreachChannel` and a
valid `channel` on a log. Facebook drafts are AI-written and sent BY HAND from
`/outreach`, exactly as instagram and phone are. S15 removed the INBOUND lane
only; it licensed no outbound automation of any kind.

## Curl

```bash
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/summary"
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/attention?days=3&limit=20"
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/variant-stats"
curl -s -X POST -H "x-os-secret: $OS_API_SECRET" -H "content-type: application/json" \
  -d '{"contactId":"<id>","channel":"email","body":"Thanks for getting back to me.","replyToLogId":"<logId>"}' \
  "$APP_BASE_URL/api/os/drafts"
```

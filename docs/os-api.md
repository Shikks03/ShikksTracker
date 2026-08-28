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
  "engine": { "lastRunAt": null, "lastRunErrors": 0 },
  "messenger": { "lastEventAt": null, "unlinkedCount": 0, "unansweredCount": 0 }
}
```

`campaigns` counts **contacts** with at least one sent / opened / clicked /
replied log — not raw log counts. This deliberately matches
`GET /api/campaigns/[id]/stats`, so the number RikuOS reports and the number the
dashboard shows can never disagree.

`hot` uses the server-side `HOT_LEAD_THRESHOLD` (default 5), the same variable
the `?hot=true` contact filter reads.

`messenger` is **always zeroed in P1.** The Messenger models arrive in P2
(Feature A of the spec); the key ships now so the response shape does not change
when they do. Until P2 lands, read `lastEventAt: null` as "no webhook yet", not
as "the webhook is dead" — the watchdog interpretation only becomes valid once
P2 is deployed.

### GET /api/os/attention

```jsonc
{
  "repliedUnanswered": [ {
    "contactId": "", "businessName": "", "contactName": null, "channel": "email",
    "repliedAt": "2026-08-21T01:00:00.000Z", "replySnippet": null,
    "lastOutboundBody": null, "keyPoints": "",
    "offerSummary": null, "toneNotes": null,
    "stage": 1, "replyToLogId": ""
  } ],
  "hotLeads": [ { "contactId": "", "businessName": "", "channel": "email", "engagementScore": 0, "pipelineStage": "", "currentStage": 0 } ],
  "overdueActions": [ { "contactId": "", "businessName": "", "nextActionAt": "", "nextActionNote": null } ]
}
```

Every `repliedUnanswered` item carries enough context to draft a reply **without a
second call** — that is why `keyPoints`, the campaign's `offerSummary`/`toneNotes`
and the previous outbound body travel inline.

A contact appears in `repliedUnanswered` when all of these hold:

1. `status` is `replied`;
2. it has no pending `draft`/`approved` log;
3. it has at least one replied log — the newest one is the anchor, and its id is
   returned as `replyToLogId`;
4. that reply is older than `days`;
5. nothing was sent after that reply.

**Creating a draft for a contact removes it from this feed** (condition 2). That
is the intended de-duplication: poll, draft, and it stops being proposed.

`replySnippet` is at most 81 characters. `lastOutboundBody` is truncated to 2000
code points with a trailing `…` (code-point-safe, so emoji are never split).

`hotLeads` excludes `replied`, `unsubscribed` and `bounced` contacts. A reply is
worth +10 engagement, so without that exclusion every replied contact would also
surface as a hot lead and RikuOS would propose two different actions for the same
person.

### GET /api/os/variant-stats

```jsonc
[ {
  "key": "email-s1-painpoint", "label": "Email S1 — pain point first",
  "channel": "email", "stage": 1,
  "sends": 0, "uniqueContacts": 0, "replies": 0, "replyRate": 0,
  "bySlice": {
    "leadSource": { "cold_email": { "sends": 0, "replies": 0, "replyRate": 0 } },
    "webPresenceTier": {}
  }
} ]
```

Counts `sent` logs only — a draft nobody approved says nothing about whether an
approach earns replies.

Variants with no sends are included, zeroed: a seeded-but-unused approach means
the rotation has not reached it yet, and omitting it would look like it had been
deleted. Conversely, a `variantKey` whose Variant was later deleted still appears
with `label`/`channel`/`stage` null — dropping those sends would overstate the
reply rate of everything that remains.

`replyRate` is a fraction (not a percentage) rounded to 4 decimal places. Missing
slice values bucket as `"unknown"`. Results are sorted by `sends` descending.

`uniqueContacts` is additive beyond the spec's listed fields; a consumer reading
only the spec fields is unaffected.

### POST /api/os/drafts

Request body:

```jsonc
{
  "contactId": "",          // required, ObjectId
  "channel": "email",       // required: email | facebook | instagram | phone
  "body": "…",              // required, 1–50000 chars
  "subject": "…",           // optional; derived as "Re: …" from the anchor if omitted
  "replyToLogId": "",       // optional, ObjectId of a SENT log for this contact
  "variantKey": ""          // optional, ≤100 chars
}
```

Creates an `EmailLog` with `origin: "rikuos"` and `status: "approved"`. It is
approved, not drafted, on purpose: the review gate exists so a human checks AI
copy before it sends, and that already happened inside RikuOS. A second approval
here would be theatre. (This mirrors `/compose`, which is likewise self-approved
by authorship.)

| Status | Meaning |
|---|---|
| 201 | Created. The log document is returned. |
| 400 | Malformed body: bad/missing id, unknown channel, empty or oversized body, malformed `replyToLogId`. |
| 401 / 503 | Auth — see above. |
| 404 | Contact not found. |
| 409 | A pending reply to the same `replyToLogId` already exists. Retry-safe: a repeated POST for the same queue item will not create a duplicate. |
| 422 | Well-formed but not actionable: contact is unsubscribed/bounced/suppressed, has no email for an email draft, `replyToLogId` is not a sent log for that contact, or an email draft has no subject and nothing to derive one from. |

A malformed `replyToLogId` is rejected rather than silently dropped. Dropping it
would produce a reply that is neither threaded *nor* permitted to reach a replied
contact — a silent half-failure that is much harder to diagnose from RikuOS than
a 400.

**What happens next.** Email drafts enter the ordinary approved queue, so the
daily send cap, the 8am–6pm Asia/Manila send window and the send-time suppression
re-check all still apply: a draft created at midnight sends in the morning, and
sends are throttled to `SENDS_PER_RUN` (default 1) per hourly cron run. Facebook,
Instagram and phone drafts appear in the manual outreach lane for copy-paste
sending — this app never sends those over an API.

`replyToLogId` does two things at send time:

1. it is the **threading anchor** — `In-Reply-To`, `References` and the Gmail
   `threadId` come from that log rather than from the stage-based lookup;
2. its presence (or `origin: "rikuos"`) is what **permits the send to reach a
   contact whose status is `replied`**. Without one of those markers the send
   path reverts the log to `draft` and it is never delivered.

Note that the stage stamped on the new log is inherited from the anchor, which is
always at or below the contact's current stage. That is deliberate: it makes the
post-send contact advance a no-op, so answering a reply can never re-enter that
contact into the cold sequence.

## Curl

```bash
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/summary"
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/attention?days=3&limit=20"
curl -s -H "x-os-secret: $OS_API_SECRET" "$APP_BASE_URL/api/os/variant-stats"
curl -s -X POST -H "x-os-secret: $OS_API_SECRET" -H "content-type: application/json" \
  -d '{"contactId":"<id>","channel":"email","body":"Thanks for getting back to me.","replyToLogId":"<logId>"}' \
  "$APP_BASE_URL/api/os/drafts"
```

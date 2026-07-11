/**
 * One-click unsubscribe endpoint — Task 6.2
 *
 * GET /api/unsubscribe/[token]
 *
 * Public route (no session required — recipients click this from email clients).
 * Must be in the proxy.ts allowlist (`/api/unsubscribe/*`).
 *
 * Behaviour:
 *   - Look up the Contact by unsubscribeToken.
 *   - If found: suppress via the shared suppressContact() helper
 *     (status → "unsubscribed", nextSendAt → null, draft/approved logs deleted,
 *      Suppression entry upserted). Idempotent — calling on an already-suppressed
 *      contact is fine (suppressContact handles it gracefully).
 *   - If NOT found: still return a neutral confirmation page — do NOT reveal
 *     whether the token was valid (same privacy stance as the tracking pixel).
 *   - Always returns a minimal HTML page (no redirect, no JSON).
 *
 * Rationale: reduces reliance on the fragile keyword opt-out reply matcher
 * (replies.ts). Both mechanisms coexist — the reply-STOP path remains active.
 * This is the single best deliverability investment because every email carries
 * an explicit opt-out link, satisfying anti-spam best-practice (and PH DPA §16).
 */

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { suppressContact } from "@/lib/contacts";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Minimal HTML page builder — self-contained, no design-system dependency.
// Recipients may click this link without cookies/session; keep it simple.
// ---------------------------------------------------------------------------

function htmlPage(title: string, message: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f4f0;
      color: #2C2A25;
    }
    .card {
      background: #fff;
      border-radius: 8px;
      padding: 40px 48px;
      max-width: 480px;
      text-align: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    h1 { font-size: 1.25rem; margin: 0 0 12px; font-weight: 600; }
    p  { font-size: 0.95rem; color: #5a5650; margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const { token } = await params;

  // Neutral response for clearly invalid tokens (empty, too long, wrong format)
  // — avoids even touching the DB for obviously bogus requests.
  if (!token || token.length > 128) {
    return htmlPage(
      "Unsubscribed",
      "You have been removed from our mailing list. You will not receive further emails from us."
    );
  }

  try {
    await connectDB();

    const contact = await Contact.findOne({ unsubscribeToken: token })
      .select({ _id: 1 })
      .lean();

    if (contact) {
      // suppressContact: upserts Suppression, sets status → "unsubscribed",
      // clears nextSendAt, deletes draft/approved logs. Idempotent.
      await suppressContact(contact._id, "unsubscribed");
    }
    // If contact is null (token not found or already gone): fall through to
    // the same neutral confirmation — do NOT leak whether the token was valid.
  } catch (err) {
    // DB errors must not show internal details to the recipient.
    console.error("[unsubscribe] DB error for token", token, err);
    // Still return the neutral confirmation — the recipient sees success, and
    // the operator can investigate via logs. Worst case: the opt-out is re-processed
    // on the next cron run when the contact's email is matched in the Suppression list.
  }

  return htmlPage(
    "Unsubscribed",
    "You have been removed from our mailing list. You will not receive further emails from us."
  );
}

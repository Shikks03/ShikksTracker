/**
 * Open-tracking pixel endpoint — Phase 7
 *
 * GET /api/track/open/[pixelId]
 *
 * Behaviour:
 *   - Find the EmailLog whose trackingPixelId matches.
 *   - Atomically increment openCount (bounded — see OPEN_COUNT_CEILING below).
 *   - Set firstOpenedAt, and bump the contact's engagementScore by SCORE_OPEN,
 *     ONLY on the first open (Security hardening, Wave C). This endpoint is
 *     public by design — the recipient, anyone they forward the mail to, or a
 *     mail-scanning proxy can reload the pixel arbitrarily. Scoring every load
 *     would let any of them inflate engagementScore without bound, poisoning
 *     the hot-leads filter. One email → at most +SCORE_OPEN, no matter how
 *     many times the pixel is fetched.
 *   - ALWAYS return a 1×1 transparent PNG (no 404 — don't leak valid pixel IDs).
 *   - DB failures are caught and logged; the pixel is still returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { bumpEngagement, SCORE_OPEN } from "@/lib/scoring";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// 1×1 transparent PNG (hardcoded bytes — no filesystem read needed)
// ---------------------------------------------------------------------------

// A minimal valid 1×1 transparent PNG (68 bytes).
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const PIXEL_BYTES = Buffer.from(TRANSPARENT_PNG_BASE64, "base64");

function pixelResponse(): NextResponse {
  return new NextResponse(PIXEL_BYTES, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

// ---------------------------------------------------------------------------
// Abuse-bound constants
// ---------------------------------------------------------------------------

/**
 * Ceiling on the raw openCount counter. This endpoint is unauthenticated by
 * design, so a hostile loop (curl in a while-loop against a leaked pixel URL)
 * must not be able to grow the counter without bound — that's still 1
 * unauthenticated DB write per request even after engagementScore stops
 * moving (see the first-open gating below). $lt here does NOT cap the
 * counter permanently at this value; it stops the $inc once reached, no
 * further writes occur for that log's openCount.
 */
const OPEN_COUNT_CEILING = 100_000;

/**
 * pixelId is a `randomUUID()` value (36 chars incl. hyphens). Anything much
 * longer is junk and rejected before touching the DB — same pattern as the
 * unsubscribe token check in src/app/api/unsubscribe/[token]/route.ts.
 */
const MAX_PIXEL_ID_LEN = 64;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ pixelId: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const { pixelId } = await params;

  // Reject obviously-invalid ids before any query. Still returns the pixel —
  // this must never be a validity oracle (see the always-200 note above).
  if (pixelId && pixelId.length <= MAX_PIXEL_ID_LEN) {
    try {
      await connectDB();

      const now = new Date();

      // Atomically increment openCount, bounded so an unauthenticated hostile
      // loop cannot grow it without limit.
      const log = await EmailLog.findOneAndUpdate(
        { trackingPixelId: pixelId, openCount: { $lt: OPEN_COUNT_CEILING } },
        { $inc: { openCount: 1 } },
        { new: true }
      ).select({ contactId: 1, firstOpenedAt: 1 });

      if (log) {
        // Set firstOpenedAt — and bump engagementScore — only on the first
        // open. The `firstOpenedAt: null` filter makes the write atomic: if
        // two pixel hits race, only the one that finds it still null writes
        // the timestamp (the other matches nothing and modifiedCount is 0),
        // so the score bump below fires at most once per email.
        const firstOpenResult = await EmailLog.updateOne(
          { _id: log._id, firstOpenedAt: null },
          { firstOpenedAt: now },
          { timestamps: false }
        );

        if (firstOpenResult.modifiedCount === 1) {
          await bumpEngagement(log.contactId, SCORE_OPEN);
        }
      } else {
        // No document matched — either the pixelId doesn't exist (fine, no
        // leak here since we never branch on it) or openCount already hit
        // the ceiling. Either way still fall through to the pixel below.
      }
    } catch (err) {
      // DB failures must not prevent the pixel from being delivered.
      console.error("[track/open] DB error for pixelId", pixelId, err);
    }
  }

  return pixelResponse();
}

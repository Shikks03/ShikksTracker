/**
 * Click-tracking redirect endpoint — Phase 8
 *
 * GET /api/track/click/[trackingId]
 *
 * Behaviour:
 *   - Find the EmailLog that contains a link with the matching trackingId.
 *   - Atomically increment clickCount (bounded — see CLICK_COUNT_CEILING).
 *   - Set firstClickedAt, and bump the contact's engagementScore by
 *     SCORE_CLICK, ONLY on the first click (Security hardening, Wave C — same
 *     rationale as track/open: this endpoint is public by design, so scoring
 *     every reload would let anyone holding the link inflate engagementScore
 *     without bound).
 *   - 302-redirect to the original URL, validated via safeRedirectUrl() so a
 *     non-http(s) URL smuggled into the stored link can never become an open
 *     redirect off our own domain.
 *   - Not found or DB error: 302-redirect to APP_BASE_URL (never an error page
 *     for email recipients).
 */

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { bumpEngagement, SCORE_CLICK } from "@/lib/scoring";
import { safeRedirectUrl } from "@/lib/tracking";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fallback URL
// ---------------------------------------------------------------------------

function fallbackUrl(): string {
  return process.env.APP_BASE_URL ?? "https://shikkstracker.vercel.app";
}

// ---------------------------------------------------------------------------
// Abuse-bound constants
// ---------------------------------------------------------------------------

/** Mirrors OPEN_COUNT_CEILING in the open-pixel route — see that file for rationale. */
const CLICK_COUNT_CEILING = 100_000;

/**
 * trackingId is a `randomUUID()` value (36 chars incl. hyphens). Anything
 * much longer is junk and rejected before touching the DB — same pattern as
 * the unsubscribe token check in src/app/api/unsubscribe/[token]/route.ts.
 */
const MAX_TRACKING_ID_LEN = 64;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ trackingId: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const { trackingId } = await params;

  // Reject obviously-invalid ids before any query. Still redirects — this
  // must never show an error page to a recipient (see the top-of-file note).
  if (trackingId && trackingId.length <= MAX_TRACKING_ID_LEN) {
    try {
      await connectDB();

      // Find the log containing this trackingId in its links array.
      const log = await EmailLog.findOne({ "links.trackingId": trackingId }).select({
        contactId: 1,
        links: 1,
        firstClickedAt: 1,
      });

      if (log) {
        const linkEntry = log.links.find((l) => l.trackingId === trackingId);
        const originalUrl = safeRedirectUrl(linkEntry?.url, fallbackUrl());

        const now = new Date();

        // Atomically increment clickCount, bounded so an unauthenticated
        // hostile loop cannot grow it without limit.
        await EmailLog.updateOne(
          { _id: log._id, clickCount: { $lt: CLICK_COUNT_CEILING } },
          { $inc: { clickCount: 1 } }
        );

        // Set firstClickedAt — and bump engagementScore — only on the first
        // click. `updateOne` with `firstClickedAt: null` in the filter makes
        // this atomic: if two clicks race, only the one that finds it still
        // null modifies the document (the other matches nothing), so the
        // score bump below fires at most once per email. This replaces the
        // previous read-then-write (`if (!log.firstClickedAt) { ... }`),
        // which let two concurrent clicks both pass the check and both write.
        const firstClickResult = await EmailLog.updateOne(
          { _id: log._id, firstClickedAt: null },
          { $set: { firstClickedAt: now } }
        );

        if (firstClickResult.modifiedCount === 1) {
          await bumpEngagement(log.contactId, SCORE_CLICK);
        }

        return NextResponse.redirect(originalUrl, { status: 302 });
      }
    } catch (err) {
      // DB failures must not show an error page to the email recipient.
      console.error("[track/click] DB error for trackingId", trackingId, err);
    }
  }

  // Not found, invalid id, or error: redirect to home
  return NextResponse.redirect(fallbackUrl(), { status: 302 });
}

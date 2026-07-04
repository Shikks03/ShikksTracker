/**
 * Click-tracking redirect endpoint — Phase 8
 *
 * GET /api/track/click/[trackingId]
 *
 * Behaviour:
 *   - Find the EmailLog that contains a link with the matching trackingId.
 *   - Atomically increment clickCount; set firstClickedAt on first click.
 *   - Bump the contact's engagementScore by SCORE_CLICK.
 *   - 302-redirect to the original URL.
 *   - Not found or DB error: 302-redirect to APP_BASE_URL (never an error page
 *     for email recipients).
 */

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { bumpEngagement, SCORE_CLICK } from "@/lib/scoring";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Fallback URL
// ---------------------------------------------------------------------------

function fallbackUrl(): string {
  return process.env.APP_BASE_URL ?? "https://shikkstracker.vercel.app";
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ trackingId: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const { trackingId } = await params;

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
      const originalUrl = linkEntry?.url ?? fallbackUrl();

      const now = new Date();

      // Atomically increment clickCount.
      await EmailLog.findByIdAndUpdate(log._id, { $inc: { clickCount: 1 } });

      // Set firstClickedAt only on the first click.
      if (!log.firstClickedAt) {
        await EmailLog.findByIdAndUpdate(log._id, { firstClickedAt: now });
      }

      await bumpEngagement(log.contactId, SCORE_CLICK);

      return NextResponse.redirect(originalUrl, { status: 302 });
    }
  } catch (err) {
    // DB failures must not show an error page to the email recipient.
    console.error("[track/click] DB error for trackingId", trackingId, err);
  }

  // Not found or error: redirect to home
  return NextResponse.redirect(fallbackUrl(), { status: 302 });
}

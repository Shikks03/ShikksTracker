/**
 * Open-tracking pixel endpoint — Phase 7
 *
 * GET /api/track/open/[pixelId]
 *
 * Behaviour:
 *   - Find the EmailLog whose trackingPixelId matches.
 *   - Atomically increment openCount; set firstOpenedAt on first open.
 *   - Bump the contact's engagementScore by SCORE_OPEN.
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
// Route handler
// ---------------------------------------------------------------------------

type RouteContext = { params: Promise<{ pixelId: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const { pixelId } = await params;

  try {
    await connectDB();

    const now = new Date();

    // Atomically increment openCount; retrieve the updated document so we
    // have contactId for the engagement bump.
    const log = await EmailLog.findOneAndUpdate(
      { trackingPixelId: pixelId },
      { $inc: { openCount: 1 } },
      { new: true }
    ).select({ contactId: 1, firstOpenedAt: 1 });

    if (log) {
      // Set firstOpenedAt only on the first open. The `firstOpenedAt: null`
      // filter makes this atomic: if two pixel hits race, only the one that
      // finds it still null writes the timestamp (the other matches nothing).
      if (!log.firstOpenedAt) {
        await EmailLog.updateOne(
          { _id: log._id, firstOpenedAt: null },
          { firstOpenedAt: now },
          { timestamps: false }
        );
      }

      await bumpEngagement(log.contactId, SCORE_OPEN);
    }
  } catch (err) {
    // DB failures must not prevent the pixel from being delivered.
    console.error("[track/open] DB error for pixelId", pixelId, err);
  }

  return pixelResponse();
}

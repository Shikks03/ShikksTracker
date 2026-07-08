import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Validate sequenceSpacingDays: must be an array of exactly 3 non-negative
 * numbers that are strictly increasing and start at 0.
 * Returns an error string on failure, or null if valid.
 */
function validateSequenceSpacingDays(value: unknown): string | null {
  if (!Array.isArray(value)) return "sequenceSpacingDays must be an array";
  if (value.length !== 3) return "sequenceSpacingDays must have exactly 3 elements";
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) {
      return "sequenceSpacingDays elements must be non-negative numbers";
    }
  }
  if (value[0] !== 0) return "sequenceSpacingDays must start at 0";
  if (value[1] <= value[0] || value[2] <= value[1]) {
    return "sequenceSpacingDays must be strictly increasing";
  }
  return null;
}

export async function GET() {
  try {
    await connectDB();
    const campaigns = await Campaign.find().lean();
    return NextResponse.json(campaigns);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json() as Record<string, unknown>;

    // Require non-empty name
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    // Require non-empty offerSummary
    if (typeof body.offerSummary !== "string" || body.offerSummary.trim() === "") {
      return NextResponse.json({ error: "offerSummary is required" }, { status: 400 });
    }

    // Build the explicit field pick (schema fields only)
    const payload: Record<string, unknown> = {
      name: body.name.trim(),
      offerSummary: body.offerSummary.trim(),
    };

    if (body.toneNotes !== undefined && body.toneNotes !== null) {
      if (typeof body.toneNotes !== "string") {
        return NextResponse.json({ error: "toneNotes must be a string" }, { status: 400 });
      }
      payload.toneNotes = body.toneNotes;
    }

    if (body.sequenceSpacingDays !== undefined) {
      const err = validateSequenceSpacingDays(body.sequenceSpacingDays);
      if (err) {
        return NextResponse.json({ error: err }, { status: 400 });
      }
      payload.sequenceSpacingDays = body.sequenceSpacingDays;
    }
    // If sequenceSpacingDays is omitted, the schema default [0, 5, 9] applies.

    const campaign = await Campaign.create(payload);
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

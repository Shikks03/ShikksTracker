import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { handleError } from "@/lib/api";
import { validateSequenceSpacingDays } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const campaigns = await Campaign.find().lean();
    return NextResponse.json(campaigns);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
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
      const validated = validateSequenceSpacingDays(body.sequenceSpacingDays);
      if (validated === null) {
        return NextResponse.json(
          { error: "sequenceSpacingDays must be an array of 3 strictly increasing non-negative integers starting at 0" },
          { status: 400 }
        );
      }
      payload.sequenceSpacingDays = validated;
    }
    // If sequenceSpacingDays is omitted, the schema default [0, 5, 9] applies.

    const campaign = await Campaign.create(payload);
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

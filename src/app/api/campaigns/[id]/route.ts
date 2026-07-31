import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import Contact from "@/models/Contact";
import { handleError, notFound } from "@/lib/api";
import { asObjectIdString, badRequest, validateSequenceSpacingDays } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const UPDATABLE_FIELDS = [
  "name",
  "offerSummary",
  "toneNotes",
  "sequenceSpacingDays",
] as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid campaign id");
    await connectDB();
    const campaign = await Campaign.findById(validId).lean();
    if (!campaign) return notFound(id);
    return NextResponse.json(campaign);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid campaign id");
    await connectDB();
    const body = await request.json() as Record<string, unknown>;

    const update: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) update[field] = body[field];
    }

    if ("sequenceSpacingDays" in update) {
      const validated = validateSequenceSpacingDays(update.sequenceSpacingDays);
      if (validated === null) {
        return badRequest(
          "sequenceSpacingDays must be an array of 3 strictly increasing non-negative integers starting at 0"
        );
      }
      update.sequenceSpacingDays = validated;
    }

    const campaign = await Campaign.findByIdAndUpdate(validId, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!campaign) return notFound(id);
    return NextResponse.json(campaign);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid campaign id");
    await connectDB();

    const contactCount = await Contact.countDocuments({ campaignId: validId });
    if (contactCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete: ${contactCount} contact${contactCount === 1 ? "" : "s"} still reference this campaign. Delete or move those contacts first.`,
        },
        { status: 409 }
      );
    }

    const campaign = await Campaign.findByIdAndDelete(validId).lean();
    if (!campaign) return notFound(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

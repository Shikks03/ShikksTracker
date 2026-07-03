import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { handleError, notFound } from "@/lib/api";

export const dynamic = "force-dynamic";

const UPDATABLE_FIELDS = [
  "name",
  "offerSummary",
  "toneNotes",
  "sequenceSpacingDays",
] as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const campaign = await Campaign.findById(id).lean();
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
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;

    const update: Record<string, unknown> = {};
    for (const field of UPDATABLE_FIELDS) {
      if (field in body) update[field] = body[field];
    }

    const campaign = await Campaign.findByIdAndUpdate(id, update, {
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
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const campaign = await Campaign.findByIdAndDelete(id).lean();
    if (!campaign) return notFound(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { handleError, notFound } from "@/lib/api";

export const dynamic = "force-dynamic";

const UPDATABLE_FIELDS = [
  "contactName",
  "keyPoints",
  "status",
  "pipelineStage",
  "nextSendAt",
  "businessName",
] as const;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const contact = await Contact.findById(id).lean();
    if (!contact) return notFound(id);
    return NextResponse.json(contact);
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

    const contact = await Contact.findByIdAndUpdate(id, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!contact) return notFound(id);
    return NextResponse.json(contact);
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
    const contact = await Contact.findByIdAndDelete(id).lean();
    if (!contact) return notFound(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

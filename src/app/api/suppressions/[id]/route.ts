import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Suppression from "@/models/Suppression";
import { handleError, notFound } from "@/lib/api";
import { asObjectIdString, badRequest } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid suppression id");
    await connectDB();
    const suppression = await Suppression.findByIdAndDelete(validId).lean();
    if (!suppression) return notFound(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

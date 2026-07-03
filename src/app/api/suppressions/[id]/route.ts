import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Suppression from "@/models/Suppression";
import { handleError, notFound } from "@/lib/api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const suppression = await Suppression.findByIdAndDelete(id).lean();
    if (!suppression) return notFound(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

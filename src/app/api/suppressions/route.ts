import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Suppression from "@/models/Suppression";
import { handleError, isDuplicateKey } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q");

    const filter = q ? { email: { $regex: q, $options: "i" } } : {};
    const suppressions = await Suppression.find(filter).lean();
    return NextResponse.json(suppressions);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json() as Record<string, unknown>;
    const suppression = await Suppression.create(body);
    return NextResponse.json(suppression, { status: 201 });
  } catch (err) {
    if (isDuplicateKey(err)) {
      return NextResponse.json(
        { error: "Email already suppressed" },
        { status: 409 }
      );
    }
    return handleError(err);
  }
}

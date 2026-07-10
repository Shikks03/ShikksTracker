import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import CronRun from "@/models/CronRun";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const rawLimit = searchParams.get("limit");
    const limit = rawLimit
      ? Math.min(Math.max(1, parseInt(rawLimit, 10) || 1), 50)
      : 1;

    const runs = await CronRun.find({})
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();

    return NextResponse.json(runs);
  } catch (err) {
    return handleError(err);
  }
}

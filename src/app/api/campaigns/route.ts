import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

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
    const campaign = await Campaign.create(body);
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

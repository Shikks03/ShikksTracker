import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

// POST is intentionally omitted — email logs are created by the sequence engine,
// not via the public API.

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const contactId = searchParams.get("contactId");
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");

    if (contactId) filter.contactId = contactId;
    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;

    const logs = await EmailLog.find(filter).lean();
    return NextResponse.json(logs);
  } catch (err) {
    return handleError(err);
  }
}

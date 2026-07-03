import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Contact from "@/models/Contact";
import { handleError } from "@/lib/api";
import { createContactChecked, CreateContactInput } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;

    const filter: Record<string, unknown> = {};
    const campaignId = searchParams.get("campaignId");
    const status = searchParams.get("status");
    const pipelineStage = searchParams.get("pipelineStage");
    const leadSource = searchParams.get("leadSource");
    const sort = searchParams.get("sort");

    if (campaignId) filter.campaignId = campaignId;
    if (status) filter.status = status;
    if (pipelineStage) filter.pipelineStage = pipelineStage;
    if (leadSource) filter.leadSource = leadSource;

    let query = Contact.find(filter);
    if (sort === "score") {
      query = query.sort({ engagementScore: -1 });
    }

    const contacts = await query.lean();
    return NextResponse.json(contacts);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateContactInput;
    const result = await createContactChecked(body, "manual");

    switch (result.outcome) {
      case "invalid":
        return NextResponse.json({ error: result.reason }, { status: 400 });
      case "suppressed":
        return NextResponse.json(
          { error: "Email is suppressed", reason: result.reason },
          { status: 422 }
        );
      case "duplicate":
        return NextResponse.json(
          { error: "Duplicate: resource already exists" },
          { status: 409 }
        );
      case "inserted":
        return NextResponse.json(result.contact, { status: 201 });
    }
  } catch (err) {
    return handleError(err);
  }
}

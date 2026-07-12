import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Template from "@/models/Template";
import { handleError } from "@/lib/api";
import { validateTemplateBody } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectDB();
    // Newest first; _id sort is equivalent to createdAt sort and avoids
    // requiring a separate timestamp index.
    const templates = await Template.find().sort({ _id: -1 }).lean();
    return NextResponse.json(templates);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const result = validateTemplateBody(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Explicit field pick — never pass raw body to Model.create (Task 1.3)
    const template = await Template.create({
      name:    result.fields.name,
      subject: result.fields.subject,
      body:    result.fields.body,
    });
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

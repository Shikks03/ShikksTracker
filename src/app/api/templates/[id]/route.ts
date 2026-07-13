import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Template from "@/models/Template";
import { handleError, notFound } from "@/lib/api";
import { validateTemplateBody } from "@/lib/templates";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const template = await Template.findByIdAndDelete(id).lean();
    if (!template) return notFound(id);
    return NextResponse.json({ deleted: true });
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
    const body = (await request.json()) as Record<string, unknown>;

    const result = validateTemplateBody(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Explicit field pick — never pass the raw body to the model (Task 1.3 pattern)
    const template = await Template.findByIdAndUpdate(
      id,
      {
        name:    result.fields.name,
        subject: result.fields.subject,
        body:    result.fields.body,
      },
      { new: true, runValidators: true }
    ).lean();

    if (!template) return notFound(id);
    return NextResponse.json(template);
  } catch (err) {
    return handleError(err);
  }
}

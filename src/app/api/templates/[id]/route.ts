import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Template from "@/models/Template";
import { handleError, notFound } from "@/lib/api";
import { validateTemplateBody } from "@/lib/templates";
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
    if (validId === null) return badRequest("Invalid template id");
    await connectDB();
    const template = await Template.findByIdAndDelete(validId).lean();
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
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid template id");
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const result = validateTemplateBody(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Explicit field pick — never pass the raw body to the model (Task 1.3 pattern)
    const template = await Template.findByIdAndUpdate(
      validId,
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

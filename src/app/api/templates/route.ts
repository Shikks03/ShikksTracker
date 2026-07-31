import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Template from "@/models/Template";
import { handleError } from "@/lib/api";
import { validateTemplateBody } from "@/lib/templates";
import { parseLimit, parseOffset } from "@/lib/env";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;
    // Bounded (security-phase-2, Wave C): default cap high (1000) so nothing
    // existing breaks; only guards against unbounded growth.
    const limit = parseLimit(searchParams, 1000, 5000);
    const offset = parseOffset(searchParams, 100_000);
    // Newest first; _id sort is equivalent to createdAt sort and avoids
    // requiring a separate timestamp index.
    const templates = await Template.find()
      .sort({ _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    return NextResponse.json(templates);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
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

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { handleError } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const settings = await getSettings();
    return NextResponse.json(settings);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const body = (await request.json()) as Record<string, unknown>;

    const patch: { draftGenerationEnabled?: boolean; sendingEnabled?: boolean } = {};

    if (body.draftGenerationEnabled !== undefined) {
      if (typeof body.draftGenerationEnabled !== "boolean") {
        return NextResponse.json(
          { error: "draftGenerationEnabled must be a boolean" },
          { status: 400 }
        );
      }
      patch.draftGenerationEnabled = body.draftGenerationEnabled;
    }

    if (body.sendingEnabled !== undefined) {
      if (typeof body.sendingEnabled !== "boolean") {
        return NextResponse.json(
          { error: "sendingEnabled must be a boolean" },
          { status: 400 }
        );
      }
      patch.sendingEnabled = body.sendingEnabled;
    }

    const settings = await updateSettings(patch);
    return NextResponse.json(settings);
  } catch (err) {
    return handleError(err);
  }
}

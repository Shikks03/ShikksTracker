import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError, notFound } from "@/lib/api";
import { asObjectIdString, badRequest } from "@/lib/validate";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET — single email log
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid email log id");
    await connectDB();
    const log = await EmailLog.findById(validId).lean();
    if (!log) return notFound(id);
    return NextResponse.json(log);
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// PATCH — edit subject/body (draft only) or change status (draft↔approved)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid email log id");
    await connectDB();
    const log = await EmailLog.findById(validId);
    if (!log) return notFound(id);

    // Blanket guard: "sent" and "sending" logs are immutable.
    // "sending" means a Gmail send is in-flight — editing it would corrupt the audit trail
    // or race with the send. If the log is stuck in "sending", the stale-send sweep will
    // revert it to "draft" after 10 minutes so normal editing can resume.
    if (log.status === "sent" || log.status === "sending") {
      return NextResponse.json(
        { error: `Cannot modify a ${log.status} email log.` },
        { status: 409 }
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    // Content edits: allowed only while draft
    if ("subject" in body || "body" in body) {
      if (log.status !== "draft") {
        return NextResponse.json(
          { error: "Subject and body can only be edited while status is 'draft'." },
          { status: 409 }
        );
      }
      if (typeof body.subject === "string") update.subject = body.subject;
      if (typeof body.body === "string") update.body = body.body;
    }

    // Status transition
    if ("status" in body) {
      const requested = body.status as string;
      const current = log.status;

      const allowed =
        (current === "draft" && requested === "approved") ||
        (current === "approved" && requested === "draft");

      if (!allowed) {
        return NextResponse.json(
          {
            error: `Invalid status transition: '${current}' → '${requested}'. Allowed: draft→approved, approved→draft.`,
          },
          { status: 400 }
        );
      }

      update.status = requested;
    }

    const updated = await EmailLog.findByIdAndUpdate(validId, update, {
      new: true,
      runValidators: true,
    }).lean();
    if (!updated) return notFound(id);
    return NextResponse.json(updated);
  } catch (err) {
    return handleError(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE — discard a draft only
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext
) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    const { id } = await params;
    const validId = asObjectIdString(id);
    if (validId === null) return badRequest("Invalid email log id");
    await connectDB();
    const log = await EmailLog.findById(validId).lean();
    if (!log) return notFound(id);

    if (log.status !== "draft") {
      return NextResponse.json(
        { error: `Only draft logs may be deleted. This log is '${log.status}'.` },
        { status: 409 }
      );
    }

    await EmailLog.findByIdAndDelete(validId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

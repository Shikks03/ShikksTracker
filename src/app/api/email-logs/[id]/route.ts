import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import EmailLog from "@/models/EmailLog";
import { handleError, notFound } from "@/lib/api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET — single email log
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const log = await EmailLog.findById(id).lean();
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
  try {
    await connectDB();
    const { id } = await params;
    const log = await EmailLog.findById(id);
    if (!log) return notFound(id);

    // Blanket guard: nothing may touch a sent log
    if (log.status === "sent") {
      return NextResponse.json(
        { error: "Cannot modify a sent email log." },
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

    const updated = await EmailLog.findByIdAndUpdate(id, update, {
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
  _request: NextRequest,
  { params }: RouteContext
) {
  try {
    await connectDB();
    const { id } = await params;
    const log = await EmailLog.findById(id).lean();
    if (!log) return notFound(id);

    if (log.status !== "draft") {
      return NextResponse.json(
        { error: `Only draft logs may be deleted. This log is '${log.status}'.` },
        { status: 409 }
      );
    }

    await EmailLog.findByIdAndDelete(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}

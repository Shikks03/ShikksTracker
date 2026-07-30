import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Suppression from "@/models/Suppression";
import { handleError } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/contacts";
// Shared with createContactChecked's case-insensitive businessName dedupe.
// Was a private copy here until 2026-07-30; two identical escapers is exactly
// the drift this codebase already had to clean up once (Task 5.1).
import { escapeRegex } from "@/lib/email";

export const dynamic = "force-dynamic";

const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "manual"] as const;
type SuppressionReason = typeof SUPPRESSION_REASONS[number];

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q");

    const filter = q ? { email: { $regex: escapeRegex(q), $options: "i" } } : {};
    const suppressions = await Suppression.find(filter).lean();
    return NextResponse.json(suppressions);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json() as Record<string, unknown>;

    // Validate and normalise email
    const rawEmail = body.email;
    if (typeof rawEmail !== "string" || rawEmail.trim() === "") {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Validate reason (default: "manual" per schema intent when omitted)
    const rawReason = body.reason;
    let reason: SuppressionReason;
    if (rawReason === undefined || rawReason === null) {
      reason = "manual";
    } else if (typeof rawReason === "string" && (SUPPRESSION_REASONS as readonly string[]).includes(rawReason)) {
      reason = rawReason as SuppressionReason;
    } else {
      return NextResponse.json(
        { error: `reason must be one of: ${SUPPRESSION_REASONS.join(", ")}` },
        { status: 400 }
      );
    }

    const suppression = await Suppression.create({ email, reason });
    return NextResponse.json(suppression, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Suppression from "@/models/Suppression";
import { handleError } from "@/lib/api";
import { isValidEmail, normalizeEmail } from "@/lib/contacts";
// Shared with createContactChecked's case-insensitive businessName dedupe.
// Was a private copy here until 2026-07-30; two identical escapers is exactly
// the drift this codebase already had to clean up once (Task 5.1).
import { escapeRegex } from "@/lib/email";
import { parseLimit, parseOffset } from "@/lib/env";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "manual"] as const;
type SuppressionReason = typeof SUPPRESSION_REASONS[number];

export async function GET(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q");

    // Index-bypass fix, NOT an injection fix (escapeRegex below already
    // neutralizes regex metacharacters — there is no ReDoS or operator
    // injection here). The problem: an unanchored case-insensitive $regex
    // can't use the unique `email` index, so every search was a full
    // collection scan with no bound on the length of `q`. Clamping to 128
    // chars and anchoring with `^` turns this into an (index-servable)
    // prefix search. Do not "simplify" this back to a bare escapeRegex(q).
    const clampedQ = q ? q.slice(0, 128) : null;
    const filter = clampedQ
      ? { email: { $regex: `^${escapeRegex(clampedQ)}`, $options: "i" } }
      : {};
    // Bounded (security-phase-2, Wave C): default cap high (1000) so nothing
    // existing breaks; only guards against unbounded growth.
    const limit = parseLimit(searchParams, 1000, 5000);
    const offset = parseOffset(searchParams, 100_000);
    const suppressions = await Suppression.find(filter).skip(offset).limit(limit).lean();
    return NextResponse.json(suppressions);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
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

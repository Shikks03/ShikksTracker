import { NextResponse } from "next/server";
import mongoose from "mongoose";

/** Maps known error types to HTTP responses. Unknown errors → 500. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof mongoose.Error.ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function notFound(id: string): NextResponse {
  return NextResponse.json({ error: `Not found: ${id}` }, { status: 404 });
}

/** Returns true for MongoDB duplicate-key errors (code 11000). */
export function isDuplicateKey(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 11000
  );
}

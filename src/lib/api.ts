import { NextResponse } from "next/server";
import mongoose from "mongoose";

/** Maps known error types to HTTP responses. Unknown errors → 500. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof mongoose.Error.ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof mongoose.Error.CastError) {
    return NextResponse.json(
      { error: `Invalid value for field "${err.path}": ${err.value}` },
      { status: 400 }
    );
  }
  if (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 11000
  ) {
    return NextResponse.json(
      { error: "Duplicate: resource already exists" },
      { status: 409 }
    );
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export function notFound(id: string): NextResponse {
  return NextResponse.json({ error: `Not found: ${id}` }, { status: 404 });
}

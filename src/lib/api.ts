import { NextResponse } from "next/server";
import mongoose from "mongoose";

/** Maps known error types to HTTP responses. Unknown errors → 500. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof mongoose.Error.ValidationError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof mongoose.Error.CastError) {
    // Do NOT echo err.value back into the response — it is raw attacker
    // input (e.g. request-body/query-string content Mongoose failed to
    // cast) and this is a reflected-input sink. Only the schema field path
    // is safe to return.
    return NextResponse.json(
      { error: `Invalid value for field "${err.path}"` },
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

/**
 * Safely converts a caught error into a message that can be sent to the
 * client. Several route files currently do
 * `err instanceof Error ? err.message : String(err)` and return that raw
 * text to the client — but driver-level errors (Mongo, Gmail/googleapis,
 * fetch, etc.) can carry connection strings, hostnames, stack fragments, or
 * other internal detail an attacker (or just a curious user) shouldn't see.
 *
 * Only mongoose ValidationError messages are treated as "safe" here: they
 * are schema-generated (built from the field names and validators the app
 * itself defined), not attacker- or driver-controlled text. Every other
 * error type — including a generic `Error` — is treated as unsafe: the
 * real error is logged server-side via console.error for debugging, and the
 * client gets a fixed generic string so nothing internal leaks.
 */
export function toClientMessage(err: unknown): string {
  if (err instanceof mongoose.Error.ValidationError) {
    return err.message;
  }
  console.error(err);
  return "Operation failed";
}

import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { verifyMetaSignature, verifyMetaVerifyToken } from "@/lib/messenger/signature";
import { parseMessengerPayload } from "@/lib/messenger/events";
import { ingestMessengerEvents } from "@/lib/messenger/ingest";

export const dynamic = "force-dynamic";

/**
 * GET — Meta's one-time verification handshake (spec §A.2).
 *
 * The challenge must come back as BARE text/plain. Wrapping it in JSON fails
 * verification in the console with a message that does not say why.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const result = verifyMetaVerifyToken(
    searchParams.get("hub.mode"),
    searchParams.get("hub.verify_token"),
    searchParams.get("hub.challenge"),
    process.env.META_VERIFY_TOKEN
  );

  if (!result.ok) {
    return new NextResponse(result.error, {
      status: result.httpStatus,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

/**
 * POST — event delivery.
 *
 * TWO RULES, both load-bearing:
 *
 * 1. Read the RAW body and verify BEFORE parsing. `request.json()` would
 *    re-serialise and break the HMAC. text() then JSON.parse, in that order.
 *
 * 2. Return 200 for anything that passes the signature check, including when
 *    processing fails. Meta retries non-200s and eventually disables the
 *    subscription on a dev-mode app — an outage that presents as "replies
 *    stopped arriving" days later, with nothing in our logs.
 *
 * A signature failure is the one exception: that is not our event to accept.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const sig = verifyMetaSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    process.env.META_APP_SECRET
  );
  if (!sig.ok) {
    return NextResponse.json({ error: sig.error }, { status: sig.httpStatus });
  }

  try {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Signed by us but not JSON. Nothing to do, nothing to retry.
      return NextResponse.json({ ok: true, ignored: "unparseable" });
    }

    const events = parseMessengerPayload(payload);
    if (events.length === 0) {
      return NextResponse.json({ ok: true, events: 0 });
    }

    await connectDB();
    const result = await ingestMessengerEvents(events);

    if (result.errors.length > 0) {
      console.error("[messenger-webhook] ingest errors:", result.errors);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    // Deliberately swallowed into a 200. See rule 2 above.
    console.error(
      "[messenger-webhook] unhandled:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ ok: true, error: "logged" });
  }
}

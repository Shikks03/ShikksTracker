import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { sendGmailMessage } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    const result = await sendGmailMessage({
      to: "me", // Gmail API resolves "me" to the authenticated user's address
      subject: "Outreach tool test send",
      htmlBody: `
        <h2>Outreach tool test send</h2>
        <p>If you received this message, your Gmail integration is working correctly.</p>
        <p>Sent at: ${new Date().toISOString()}</p>
      `,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[test/send-self]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

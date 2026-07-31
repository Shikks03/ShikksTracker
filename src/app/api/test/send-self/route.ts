import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/auth";
import { getGmailClient, getSenderAddress, sendGmailMessage } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.ALLOW_TEST_ROUTES !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authError = requireCronSecret(request);
  if (authError) return authError;

  try {
    const gmail = getGmailClient();
    const selfAddress = await getSenderAddress(gmail);
    const result = await sendGmailMessage({
      to: selfAddress,
      subject: "Outreach tool test send",
      htmlBody: `
        <h2>Outreach tool test send</h2>
        <p>If you received this message, your Gmail integration is working correctly.</p>
        <p>Sent at: ${new Date().toISOString()}</p>
      `,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[test/send-self]", err);
    return NextResponse.json({ error: "Send failed" }, { status: 500 });
  }
}

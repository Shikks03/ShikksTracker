import { google } from "googleapis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export async function GET(): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appBaseUrl = process.env.APP_BASE_URL;

  if (!clientId || !clientSecret || !appBaseUrl) {
    const missing = [
      !clientId && "GOOGLE_CLIENT_ID",
      !clientSecret && "GOOGLE_CLIENT_SECRET",
      !appBaseUrl && "APP_BASE_URL",
    ]
      .filter(Boolean)
      .join(", ");
    return NextResponse.json(
      { error: `Missing environment variables: ${missing}` },
      { status: 500 }
    );
  }

  const redirectUri = `${appBaseUrl}/api/auth/gmail/callback`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    redirect_uri: redirectUri,
  });

  return NextResponse.redirect(url);
}

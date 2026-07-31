import { google } from "googleapis";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export async function GET(): Promise<NextResponse> {
  // This endpoint is a one-time dev tool for obtaining a Gmail refresh token.
  // Disable it in production to prevent unintended OAuth flows.
  if (
    process.env.NODE_ENV !== "development" &&
    process.env.ALLOW_OAUTH_BOOTSTRAP !== "true"
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

  // CSRF protection: bind this authorization attempt to a random state value
  // stored in a short-lived cookie, verified by the callback before any code
  // exchange happens. Without this, an attacker can walk a logged-in operator
  // through a callback carrying the ATTACKER's authorization code, tricking
  // them into installing the attacker's refresh token.
  const state = crypto.randomUUID();

  const url = auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  const response = NextResponse.redirect(url);
  response.cookies.set("gmail_oauth_state", state, {
    maxAge: 600,
    httpOnly: true,
    secure: true,
    // "lax" (not "strict") is required: this cookie must survive Google's
    // cross-site redirect back to our callback.
    sameSite: "lax",
    path: "/",
  });
  return response;
}

import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // This endpoint is part of the one-time dev OAuth bootstrap flow.
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
    return new NextResponse(
      `<html><body><h2>Configuration error</h2><p>Missing environment variables: <strong>${missing}</strong></p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const cookieState = request.cookies.get("gmail_oauth_state")?.value;

  // Clear the one-time state cookie once we've read it — it's single-use
  // regardless of whether validation below succeeds or fails.
  const clearStateCookie = (response: NextResponse): NextResponse => {
    response.cookies.set("gmail_oauth_state", "", { maxAge: 0, path: "/" });
    return response;
  };

  // CSRF check: the state value must be present in both the query string and
  // the cookie set by /api/auth/gmail, and they must match. Plain equality is
  // fine here — these are random UUIDs, not secrets that need timing-safe
  // comparison. Reject before exchanging any code.
  if (!state || !cookieState || state !== cookieState) {
    return clearStateCookie(
      new NextResponse(
        `<html><body>
          <h2>Invalid or expired request</h2>
          <p>Please restart the OAuth flow from <code>/api/auth/gmail</code>.</p>
        </body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      )
    );
  }

  if (error) {
    return clearStateCookie(
      new NextResponse(
        `<html><body>
          <h2>OAuth error</h2>
          <p>Google returned an error: <strong>${escapeHtml(error)}</strong></p>
          <p>Please close this window and try again.</p>
        </body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      )
    );
  }

  if (!code) {
    return clearStateCookie(
      new NextResponse(
        `<html><body>
          <h2>Missing authorization code</h2>
          <p>No <code>code</code> parameter was found in the callback URL.</p>
        </body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      )
    );
  }

  const redirectUri = `${appBaseUrl}/api/auth/gmail/callback`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  let refreshToken: string | null | undefined;
  try {
    const { tokens } = await auth.getToken(code);
    refreshToken = tokens.refresh_token;
  } catch (err) {
    console.error("[auth/gmail/callback] token exchange failed", err);
    return clearStateCookie(
      new NextResponse(
        `<html><body>
          <h2>Token exchange failed</h2>
          <p>Please close this window and try again.</p>
        </body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      )
    );
  }

  if (!refreshToken) {
    return clearStateCookie(
      new NextResponse(
        `<html><body>
          <h2>No refresh token received</h2>
          <p>Google did not return a <code>refresh_token</code>. This usually happens because
          you have already granted consent to this OAuth client previously. The existing grant
          does not include a refresh token in subsequent exchanges.</p>
          <h3>To fix this:</h3>
          <ol>
            <li>Go to <a href="https://myaccount.google.com/permissions" target="_blank">myaccount.google.com/permissions</a></li>
            <li>Find this application and click <strong>Remove access</strong></li>
            <li>Return to <code>/api/auth/gmail</code> and complete the flow again</li>
          </ol>
        </body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );
  }

  return clearStateCookie(
    new NextResponse(
      `<html><body style="font-family:monospace;max-width:800px;margin:2rem auto;padding:0 1rem">
        <h2>Gmail OAuth successful</h2>
        <p>Copy the refresh token below and paste it into your <code>.env.local</code> file,
        then restart your dev server.</p>
        <h3>GOOGLE_REFRESH_TOKEN</h3>
        <pre style="background:#f4f4f4;padding:1rem;word-break:break-all;white-space:pre-wrap">${escapeHtml(refreshToken)}</pre>
        <p>Add this line to <code>.env.local</code>:</p>
        <pre style="background:#f4f4f4;padding:1rem">GOOGLE_REFRESH_TOKEN=${escapeHtml(refreshToken)}</pre>
        <p><strong>Do not share this token.</strong> It grants send and read access to your Gmail account.</p>
        <p>After saving the file and restarting the server, verify the setup with:<br>
        <code>Invoke-WebRequest -Method POST -Uri http://localhost:3000/api/test/send-self -Headers @{"x-cron-secret"="&lt;your CRON_SECRET&gt;"}</code>
        </p>
      </body></html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Referrer-Policy": "no-referrer",
        },
      }
    )
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

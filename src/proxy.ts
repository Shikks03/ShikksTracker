import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

/**
 * Returns true for paths that do not require a session cookie.
 *
 * Public paths:
 *   /api/track/*       — recipient-facing pixel/click endpoints
 *   /api/cron/*        — guarded by x-cron-secret; leave that mechanism intact
 *   /api/test/*        — guarded by x-cron-secret
 *   /api/health        — exact match
 *   /login             — exact match (the login page itself)
 *   /api/auth/login    — exact match (the login POST handler)
 *   /_next/*           — Next.js internals (also excluded by matcher, belt+suspenders)
 *   /favicon.ico       — static asset
 *
 * NOTE: /api/auth/gmail* is deliberately NOT public — it stays behind the session.
 */
function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith("/api/track/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/test/") ||
    pathname.startsWith("/_next/")
  ) {
    return true;
  }
  if (
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/favicon.ico"
  ) {
    return true;
  }
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Always let public paths through
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD;

  // Fail closed: DASHBOARD_PASSWORD must be configured
  if (!password) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: "DASHBOARD_PASSWORD is not configured." },
        { status: 503 }
      );
    }
    return new NextResponse(
      "Service unavailable: DASHBOARD_PASSWORD must be configured before the dashboard can be accessed.",
      { status: 503, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Validate session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value ?? "";
  const valid = token ? await verifySessionToken(token, password) : false;

  if (valid) {
    return NextResponse.next();
  }

  // Not authenticated
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Redirect pages to /login with a ?from= param so the login page can redirect back
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     *   - _next/static  (static assets)
     *   - _next/image   (image optimisation)
     *   - favicon.ico   (browser default request)
     * Fine-grained public-path logic is done in isPublicPath() above.
     */
    "/((?!_next/static|_next/image|favicon\\.ico).*)",
  ],
};

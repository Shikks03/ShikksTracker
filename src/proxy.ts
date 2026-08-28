import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

/**
 * Returns true for paths that do not require a session cookie.
 *
 * Public paths:
 *   /api/track/*       — recipient-facing pixel/click endpoints
 *   /api/cron/*        — guarded by x-cron-secret; leave that mechanism intact
 *   /api/os/*          — guarded by x-os-secret (RikuOS); see requireOsSecret
 *   /api/health        — exact match
 *   /login             — exact match (the login page itself)
 *   /api/auth/login    — exact match (the login POST handler)
 *   /_next/*           — Next.js internals (also excluded by matcher, belt+suspenders)
 *   /favicon.ico       — static asset
 *
 * NOTE: /api/auth/gmail* is deliberately NOT public — it stays behind the session.
 * NOTE: /api/test/* is deliberately NOT public — those routes send real mail and
 * spend Anthropic credits, and are gated separately by their own dev-only check
 * plus x-cron-secret.
 */
function isPublicPath(pathname: string): boolean {
  // Fail closed on any encoded-traversal / bypass-prone pathname. URL parsing
  // resolves literal "../" segments but does NOT percent-decode, so something
  // like "/api/track/%2e%2e/%2e%2e/contacts" would still pass a startsWith()
  // prefix check below while actually routing elsewhere once decoded. Treat
  // any pathname containing "%", "..", or "//" as protected rather than trying
  // to enumerate every bypass encoding.
  if (pathname.includes("%") || pathname.includes("..") || pathname.includes("//")) {
    return false;
  }

  if (
    pathname.startsWith("/api/track/") ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/unsubscribe/") || // recipients click this; they are NOT logged in
    // RikuOS (a separate app in ../RikuOS) calls these server-to-server and has
    // no session cookie. Session-exempt but NOT unguarded: every /api/os/*
    // handler calls requireOsSecret() as its first statement — the same
    // arrangement as /api/cron/* and x-cron-secret.
    pathname.startsWith("/api/os/") ||
    pathname.startsWith("/_next/")
  ) {
    return true;
  }
  if (
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    // Google redirects the browser here cross-site, and the session cookie is
    // SameSite=Strict — so it is structurally impossible for this endpoint to
    // ever receive it. Leaving it "protected" would not secure it, it would
    // simply make the OAuth bootstrap unusable. It is guarded instead by its
    // own three controls: a 404 outside development (unless
    // ALLOW_OAUTH_BOOTSTRAP=true), and the `state` cookie check that rejects a
    // callback the browser did not initiate from /api/auth/gmail. The
    // initiating route itself stays behind the session.
    pathname === "/api/auth/gmail/callback" ||
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

  // Fail closed: both secrets must be configured.
  //
  // DASHBOARD_PASSWORD gates /api/auth/login; SESSION_SECRET is the HMAC key for
  // the session cookie. They are deliberately DIFFERENT secrets — the cookie must
  // never be a derivation of the password, or a leaked cookie becomes an offline
  // password-cracking oracle (see the docblock in src/lib/session.ts). Verify with
  // SESSION_SECRET only; the password is never used as a key here.
  const password = process.env.DASHBOARD_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;
  const missing = !password
    ? "DASHBOARD_PASSWORD"
    : !sessionSecret || sessionSecret.length < 32
      ? "SESSION_SECRET (must be at least 32 characters)"
      : null;

  if (missing) {
    if (isApiPath(pathname)) {
      return NextResponse.json(
        { error: `${missing} is not configured.` },
        { status: 503 }
      );
    }
    return new NextResponse(
      `Service unavailable: ${missing} must be configured before the dashboard can be accessed.`,
      { status: 503, headers: { "Content-Type": "text/plain" } }
    );
  }

  // Validate session cookie
  const token = request.cookies.get(COOKIE_NAME)?.value ?? "";
  const valid = token ? await verifySessionToken(token, sessionSecret!) : false;

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

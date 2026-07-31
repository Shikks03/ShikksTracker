import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/session";

/**
 * POST /api/auth/logout
 *
 * Clears the session cookie. No auth required — clearing your own cookie is
 * harmless (it cannot be used to affect any other session), and requiring
 * auth here would just mean a stale/expired cookie could never be cleared.
 */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}

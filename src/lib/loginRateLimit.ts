/**
 * loginRateLimit.ts — Mongo-backed login rate limiting.
 *
 * Serverless instances don't share memory, so an in-process counter would
 * only ever see a fraction of the requests — every failed attempt is
 * recorded in the LoginAttempt collection instead (TTL 15 min) and counted
 * per-IP (strict) and globally (loose, catches a distributed guesser).
 */

import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { envInt } from "@/lib/env";
import LoginAttempt from "@/models/LoginAttempt";

const MAX_IP_LENGTH = 64;

/**
 * Pure decision function — no I/O — so it is unit-testable without a DB.
 * Locked out if either the per-IP count or the global count has reached its
 * threshold. Boundary is inclusive: exactly `max` failures already locks.
 */
export function isLockedOut(
  ipFailures: number,
  globalFailures: number,
  maxPerIp: number,
  maxGlobal: number
): boolean {
  return ipFailures >= maxPerIp || globalFailures >= maxGlobal;
}

/** First hop of X-Forwarded-For, trimmed, capped at 64 chars; "unknown" if absent. */
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const first = xff.split(",")[0]?.trim();
  if (!first) return "unknown";
  return first.slice(0, MAX_IP_LENGTH);
}

function getThresholds() {
  return {
    maxPerIp: envInt("LOGIN_MAX_PER_IP", 5),
    maxGlobal: envInt("LOGIN_MAX_GLOBAL", 20),
    windowMinutes: envInt("LOGIN_WINDOW_MINUTES", 15),
  };
}

export async function checkLoginRateLimit(
  ip: string
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  await connectDB();

  const { maxPerIp, maxGlobal, windowMinutes } = getThresholds();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const [ipFailures, globalFailures] = await Promise.all([
    LoginAttempt.countDocuments({ ip, createdAt: { $gte: windowStart } }),
    LoginAttempt.countDocuments({ createdAt: { $gte: windowStart } }),
  ]);

  const locked = isLockedOut(ipFailures, globalFailures, maxPerIp, maxGlobal);
  return { locked, retryAfterSeconds: windowMinutes * 60 };
}

export async function recordLoginFailure(ip: string): Promise<void> {
  await connectDB();
  await LoginAttempt.create({ ip, createdAt: new Date() });
}

export async function clearLoginFailures(ip: string): Promise<void> {
  await connectDB();
  await LoginAttempt.deleteMany({ ip });
}

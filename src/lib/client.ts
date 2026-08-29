/**
 * client.ts — shared client-side helpers for page components.
 *
 * Consolidated 2026-07-11 (Task 5.1): `apiFetch` was copy-pasted in review,
 * contacts/[id], campaigns, and suppressions pages; dashboard/compose/import
 * used raw `fetch(...).catch(() => {})` that swallowed errors silently. This is
 * now the single fetch path so every caller can surface an error state.
 *
 * No secrets here — safe to import into client components.
 */

import { toastError } from "./toast";

export interface ApiFetchOptions {
  /**
   * Suppress the automatic error toast. For polling/background reads where a
   * failure is not something the user needs to act on. Inline error states
   * should NOT set this — a duplicate is better than a silent failure.
   */
  silent?: boolean;
}

/**
 * Fetch JSON and return `{ data, error }` instead of throwing, so callers can
 * render an error state rather than swallow the failure. On a non-2xx response
 * it reads a `{ error }` body when present, else falls back to `HTTP <status>`.
 *
 * Every failure also raises a toast (see src/lib/toast.ts). This is the one
 * choke point all pages already go through, so surfacing it here means no page
 * can fail invisibly just because its author forgot to render `error`.
 */
export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
  opts?: ApiFetchOptions
): Promise<{ data: T | null; error: string | null }> {
  const method = (options?.method ?? "GET").toUpperCase();
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      let error = body.error ?? `HTTP ${res.status}`;
      // A 401 mid-session means the cookie expired or SESSION_SECRET rotated;
      // "Unauthorized" alone reads like a permissions bug rather than "log in".
      if (res.status === 401) error = `${error} — your session expired, sign in again.`;
      if (!opts?.silent) {
        toastError(error, method === "GET" ? "COULDN'T LOAD" : "ACTION FAILED");
      }
      return { data: null, error };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    // Network-level failure: server down, DNS, offline, request blocked.
    const error = err instanceof Error ? err.message : String(err);
    if (!opts?.silent) {
      toastError(
        `${error} — the request never reached the server.`,
        method === "GET" ? "COULDN'T LOAD" : "ACTION FAILED"
      );
    }
    return { data: null, error };
  }
}

/**
 * Hot-lead score threshold used for UI highlighting. Mirror of the server-side
 * `HOT_LEAD_THRESHOLD` env var — set `NEXT_PUBLIC_HOT_LEAD_THRESHOLD` to the
 * same value to keep the UI in sync (defaults to 5). Non-secret by design.
 */
export const HOT_THRESHOLD: number = (() => {
  const raw = process.env.NEXT_PUBLIC_HOT_LEAD_THRESHOLD;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : 5;
})();

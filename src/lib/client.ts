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

/**
 * Fetch JSON and return `{ data, error }` instead of throwing, so callers can
 * render an error state rather than swallow the failure. On a non-2xx response
 * it reads a `{ error }` body when present, else falls back to `HTTP <status>`.
 */
export async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${res.status}` };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
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

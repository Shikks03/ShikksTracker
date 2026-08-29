/**
 * PSID → display name via the Graph API (spec §A.3).
 *
 * Allowed without app review for users who have messaged the page. Best-effort
 * by design: the name is only a linking hint, so a failure degrades the
 * suggestion list, never the ingestion of the message itself.
 */

const GRAPH_VERSION = "v21.0";
const PROFILE_TIMEOUT_MS = 4000;
/** Matches MessengerConversation.displayName's maxlength. */
const DISPLAY_NAME_MAX_LEN = 200;

export async function fetchDisplayName(psid: string): Promise<string> {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return "";

  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(psid)}` +
    `?fields=first_name,last_name&access_token=${encodeURIComponent(token)}`;

  try {
    // A hung Graph call must not hold the webhook open — Meta times us out and
    // retries, which would duplicate work for a cosmetic field.
    const res = await fetch(url, {
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return "";

    const data = (await res.json()) as { first_name?: string; last_name?: string };
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
    return name.slice(0, DISPLAY_NAME_MAX_LEN);
  } catch {
    // Includes the timeout, an expired page token, and a user who has blocked
    // profile access. All the same to us: no name.
    return "";
  }
}

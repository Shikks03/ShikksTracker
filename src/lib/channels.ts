/**
 * channels.ts — pure helpers for the multi-channel outreach fields.
 *
 * Contact handles arrive from three places with three different shapes: the
 * Maps scraper (usually a full URL, sometimes a bare "@handle"), manual entry
 * (anything the user types), and legacy rows (absent). Normalising them lives
 * here rather than in a page so the messy-input rules are unit-testable and
 * there is exactly one copy — the /outreach board and the contact detail page
 * both render these links and must agree.
 *
 * Pure module: no React, no DB, no server deps.
 */

export type Channel = "email" | "facebook" | "instagram" | "phone";
export type NonEmailChannel = "facebook" | "instagram" | "phone";

/**
 * Normalise a stored Facebook/Instagram handle into an openable URL.
 *   - already "http://" / "https://"      → used as-is
 *   - looks like a bare domain path        → prepend "https://"
 *   - otherwise a bare handle (optional @) → build "https://<domain>/<handle>"
 */
export function normalizeHandleUrl(
  handle: string,
  platform: "facebook" | "instagram"
): string {
  const trimmed = handle.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(www\.)?(facebook|instagram)\.com\//i.test(trimmed)) return `https://${trimmed}`;
  const bare = trimmed.replace(/^@/, "");
  const domain = platform === "facebook" ? "facebook.com" : "instagram.com";
  return `https://${domain}/${bare}`;
}

/** Website field may be a bare domain or a full URL — just ensure a scheme. */
export function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** A dialable tel: href. PH numbers are stored with spaces ("+63 74 442 4010"). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/\s+/g, "")}`;
}

// ── Display metadata (data only — the components live in ChannelBadges.tsx) ──

export const CHANNEL_META: Record<
  Channel,
  { label: string; text: string; bg: string; border: string }
> = {
  email:     { label: "EMAIL",     text: "#5B6472", bg: "#E7E6E0", border: "#C9C6BA" },
  facebook:  { label: "FACEBOOK",  text: "#2B4C86", bg: "#E4EAF6", border: "#B9C6E3" },
  instagram: { label: "INSTAGRAM", text: "#9C3468", bg: "#F6E3EC", border: "#E3B9CE" },
  phone:     { label: "PHONE",     text: "#1C6E6A", bg: "#E1F0EF", border: "#B9DEDB" },
};

/** web_presence_tier values as emitted by the Maps scraper. */
export const TIER_LABELS: Record<string, string> = {
  NO_WEB: "NO WEB",
  SOCIAL_ONLY: "SOCIAL ONLY",
  HAS_SITE: "HAS SITE",
  UNKNOWN: "UNKNOWN TIER",
};

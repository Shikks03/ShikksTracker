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

/** The contact fields a channel handle can live in. Structural, so both the
 *  dashboard row type and the contact-detail type satisfy it. */
export interface HasChannelHandles {
  outreachChannel?: string;
  phone?: string;
  facebook?: string;
  instagram?: string;
}

/** The handle for whichever channel this contact is actually worked on. */
export function channelHandle(c: HasChannelHandles): string | undefined {
  if (c.outreachChannel === "facebook") return c.facebook;
  if (c.outreachChannel === "instagram") return c.instagram;
  if (c.outreachChannel === "phone") return c.phone;
  return undefined;
}

/**
 * Shorten a stored handle for display. Handles are stored as whatever the
 * scraper captured — usually a full URL — and a row that reads
 * "HTTPS://FACEBOOK.COM/CAFEBYTHERUINS" is noise, especially since the
 * business name is already the row title. Reduce a social URL to "@handle"
 * and leave phone numbers alone (already readable).
 */
export function compactHandle(handle: string, channel?: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return "";
  if (channel === "phone") return trimmed;

  // Drop scheme, query and hash, then the known social domains.
  const withoutScheme = trimmed.replace(/^https?:\/\//i, "").replace(/[?#].*$/, "");
  const withoutDomain = withoutScheme.replace(
    /^(www\.)?(facebook|fb|instagram)\.(com|me)\//i,
    ""
  );

  // A value that never looked like a URL and contains spaces isn't a handle
  // (someone typed a name into the field) — show it as-is rather than
  // producing nonsense like "@not a real handle".
  if (withoutDomain === trimmed && /\s/.test(trimmed)) return trimmed;

  // Facebook routes real identities under these prefixes, so the FIRST path
  // segment would be meaningless ("facebook.com/pages/Foo-Cafe/123" -> "@pages").
  // Skip them and take the next segment instead.
  const NON_IDENTITY_SEGMENTS = new Set(["pages", "page", "profile.php", "p", "groups", "people"]);
  const segments = withoutDomain.split("/").filter(Boolean);
  const identity = segments.find((s) => !NON_IDENTITY_SEGMENTS.has(s.toLowerCase()));
  // No human-readable segment (e.g. "facebook.com/profile.php?id=61550", whose
  // only identity lives in the query string we stripped). Return "" rather than
  // the raw URL so displayIdentity falls through to a better label.
  if (!identity) return "";
  return `@${identity.replace(/^@/, "")}`;
}

/**
 * What to show as a contact's identity line. Precedence: contactName → the
 * compacted channel handle → contactEmail → businessName. businessName is
 * always present, so this always returns a non-empty string and callers never
 * need a null check.
 *
 * Exists because scraped Facebook/Instagram/phone leads have NEITHER a
 * contactName nor a contactEmail — several call sites used to do
 * `(contactName || contactEmail).toUpperCase()` and threw on the first such
 * contact.
 */
export function displayIdentity(
  c: HasChannelHandles & {
    businessName: string;
    contactName?: string;
    contactEmail?: string;
  }
): string {
  if (c.contactName) return c.contactName;
  // Compact FIRST, then test: a whitespace-only or unusable handle is truthy
  // but compacts to "", and returning that would break the non-empty contract.
  const rawHandle = channelHandle(c);
  const handle = rawHandle ? compactHandle(rawHandle, c.outreachChannel) : "";
  if (handle) return handle;
  if (c.contactEmail) return c.contactEmail;
  return c.businessName;
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

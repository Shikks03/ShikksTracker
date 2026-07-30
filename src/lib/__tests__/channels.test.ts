import { describe, it, expect } from "vitest";
import {
  normalizeHandleUrl,
  normalizeWebsiteUrl,
  telHref,
  compactHandle,
  displayIdentity,
  CHANNEL_META,
  TIER_LABELS,
} from "@/lib/channels";

/**
 * Handle values reach these helpers from three sources with three shapes — the
 * Maps scraper (usually a full URL), manual entry (anything), and legacy rows.
 * These are the cases that decide whether a "Open Facebook" link on the
 * Outreach board actually opens the right page, so they're worth pinning down.
 */
describe("normalizeHandleUrl", () => {
  it("passes through an already-absolute URL unchanged", () => {
    expect(normalizeHandleUrl("https://facebook.com/cafebytheruins", "facebook")).toBe(
      "https://facebook.com/cafebytheruins"
    );
    expect(normalizeHandleUrl("http://instagram.com/foo", "instagram")).toBe(
      "http://instagram.com/foo"
    );
  });

  it("is case-insensitive about the scheme", () => {
    expect(normalizeHandleUrl("HTTPS://facebook.com/x", "facebook")).toBe(
      "HTTPS://facebook.com/x"
    );
  });

  it("prepends https:// to a bare domain path", () => {
    expect(normalizeHandleUrl("facebook.com/cafebytheruins", "facebook")).toBe(
      "https://facebook.com/cafebytheruins"
    );
    expect(normalizeHandleUrl("www.instagram.com/foo", "instagram")).toBe(
      "https://www.instagram.com/foo"
    );
  });

  it("builds a profile URL from a bare @handle", () => {
    expect(normalizeHandleUrl("@sunrisedental_ph", "instagram")).toBe(
      "https://instagram.com/sunrisedental_ph"
    );
    expect(normalizeHandleUrl("@somepage", "facebook")).toBe("https://facebook.com/somepage");
  });

  it("builds a profile URL from a plain handle with no @", () => {
    expect(normalizeHandleUrl("sunrisedental_ph", "instagram")).toBe(
      "https://instagram.com/sunrisedental_ph"
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeHandleUrl("  @foo  ", "instagram")).toBe("https://instagram.com/foo");
    expect(normalizeHandleUrl("  https://facebook.com/x  ", "facebook")).toBe(
      "https://facebook.com/x"
    );
  });

  it("uses the platform argument, not the handle's own domain, for bare handles", () => {
    // A bare handle carries no domain — the caller's channel decides.
    expect(normalizeHandleUrl("shared_name", "facebook")).toBe(
      "https://facebook.com/shared_name"
    );
    expect(normalizeHandleUrl("shared_name", "instagram")).toBe(
      "https://instagram.com/shared_name"
    );
  });
});

describe("normalizeWebsiteUrl", () => {
  it("leaves absolute URLs alone and adds a scheme to bare domains", () => {
    expect(normalizeWebsiteUrl("https://example.ph")).toBe("https://example.ph");
    expect(normalizeWebsiteUrl("example.ph")).toBe("https://example.ph");
    expect(normalizeWebsiteUrl("  example.ph/menu  ")).toBe("https://example.ph/menu");
  });
});

describe("telHref", () => {
  it("strips the spaces PH numbers are stored with", () => {
    expect(telHref("+63 74 442 4010")).toBe("tel:+63744424010");
    expect(telHref("0917 123 4567")).toBe("tel:09171234567");
  });

  it("leaves an already-compact number unchanged", () => {
    expect(telHref("09171234567")).toBe("tel:09171234567");
  });
});

/**
 * These guard a crash: several dashboard/contact-detail call sites used to do
 * `(contactName || contactEmail).toUpperCase()`, which threw on the first
 * scraped Facebook/phone lead (those have NEITHER field). displayIdentity must
 * therefore always return a non-empty string, for every shape of contact.
 */
describe("compactHandle", () => {
  it("reduces a social profile URL to @handle", () => {
    expect(compactHandle("https://facebook.com/cafebytheruins", "facebook")).toBe("@cafebytheruins");
    expect(compactHandle("facebook.com/cafebytheruins/", "facebook")).toBe("@cafebytheruins");
    expect(compactHandle("https://instagram.com/sunrisedental_ph?hl=en", "instagram")).toBe("@sunrisedental_ph");
    expect(compactHandle("https://fb.me/xyz", "facebook")).toBe("@xyz");
  });

  it("leaves an already-bare @handle alone and never double-prefixes", () => {
    expect(compactHandle("@sunrisedental_ph", "instagram")).toBe("@sunrisedental_ph");
  });

  it("skips Facebook's non-identity path prefixes", () => {
    // "/pages/Foo-Cafe/12345" — the first segment is meaningless.
    expect(compactHandle("https://www.facebook.com/pages/Foo-Cafe/12345", "facebook")).toBe("@Foo-Cafe");
  });

  it("returns \"\" when no human-readable segment exists", () => {
    // The identity lives only in the stripped query string.
    expect(compactHandle("https://facebook.com/profile.php?id=61550", "facebook")).toBe("");
  });

  it("leaves phone numbers readable", () => {
    expect(compactHandle("+63 74 442 4010", "phone")).toBe("+63 74 442 4010");
  });

  it("does not mangle a value that was never a URL", () => {
    expect(compactHandle("Maria Santos", "facebook")).toBe("Maria Santos");
    expect(compactHandle("", "facebook")).toBe("");
  });
});

describe("displayIdentity", () => {
  it("never returns an empty string, whatever is missing", () => {
    const shapes = [
      { businessName: "Ghost Store" },
      { businessName: "Ghost Store", outreachChannel: "facebook", facebook: "   " },
      { businessName: "Ghost Store", outreachChannel: "facebook", facebook: "" },
      { businessName: "Ghost Store", outreachChannel: "facebook", facebook: "https://facebook.com/profile.php?id=1" },
      { businessName: "Ghost Store", outreachChannel: "phone", phone: "" },
    ];
    for (const c of shapes) {
      expect(displayIdentity(c).length).toBeGreaterThan(0);
    }
  });

  it("prefers the channel handle for a scraped lead with no name or email", () => {
    expect(
      displayIdentity({
        businessName: "Cafe by the Ruins",
        outreachChannel: "facebook",
        facebook: "https://facebook.com/cafebytheruins",
      })
    ).toBe("@cafebytheruins");
  });

  it("falls back to businessName when the handle is unusable", () => {
    expect(
      displayIdentity({ businessName: "Ghost Store", outreachChannel: "facebook", facebook: "   " })
    ).toBe("Ghost Store");
  });

  // Regression guards: email contacts must render exactly as they did before
  // the multi-channel work.
  it("is unchanged for email contacts", () => {
    expect(
      displayIdentity({
        businessName: "Acme",
        outreachChannel: "email",
        contactName: "Maria Santos",
        contactEmail: "maria@acme.ph",
      })
    ).toBe("Maria Santos");
    expect(
      displayIdentity({ businessName: "Acme", outreachChannel: "email", contactEmail: "maria@acme.ph" })
    ).toBe("maria@acme.ph");
    // Legacy contact with no outreachChannel at all.
    expect(displayIdentity({ businessName: "Old Co", contactEmail: "old@co.ph" })).toBe("old@co.ph");
  });
});

describe("display metadata", () => {
  it("has a distinct label for every channel", () => {
    const labels = Object.values(CHANNEL_META).map((m) => m.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(CHANNEL_META.facebook.label).toBe("FACEBOOK");
  });

  it("covers every web_presence_tier the scraper emits", () => {
    for (const tier of ["NO_WEB", "SOCIAL_ONLY", "HAS_SITE", "UNKNOWN"]) {
      expect(TIER_LABELS[tier]).toBeTruthy();
    }
  });
});

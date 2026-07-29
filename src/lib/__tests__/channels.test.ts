import { describe, it, expect } from "vitest";
import {
  normalizeHandleUrl,
  normalizeWebsiteUrl,
  telHref,
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

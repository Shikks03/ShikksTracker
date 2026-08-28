/**
 * Unit tests for the pure half of POST /api/os/drafts (spec §D.2).
 */

import { describe, it, expect } from "vitest";
import {
  validateOsDraftPayload,
  resolveOsDraftStage,
  deriveOsDraftSubject,
  OS_DRAFT_SUBJECT_MAX,
} from "@/lib/os/drafts";

const CONTACT_ID = "68b0f0f0f0f0f0f0f0f0f0f0";
const LOG_ID = "68b0f0f0f0f0f0f0f0f0f0f1";

describe("validateOsDraftPayload", () => {
  it("accepts a minimal email payload", () => {
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "email",
      body: "  Thanks for getting back to me.  ",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.contactId).toBe(CONTACT_ID);
      expect(result.payload.channel).toBe("email");
      expect(result.payload.body).toBe("Thanks for getting back to me.");
      expect(result.payload.subject).toBeUndefined();
      expect(result.payload.replyToLogId).toBeUndefined();
    }
  });

  it("rejects a missing contactId", () => {
    const result = validateOsDraftPayload({ channel: "email", body: "hi" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.httpStatus).toBe(400);
      expect(result.error).toContain("contactId");
    }
  });

  it("rejects a NoSQL operator smuggled in as contactId", () => {
    const result = validateOsDraftPayload({
      contactId: { $ne: null },
      channel: "email",
      body: "hi",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown channel", () => {
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "carrier-pigeon",
      body: "hi",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("channel");
  });

  it("rejects an empty body", () => {
    const result = validateOsDraftPayload({ contactId: CONTACT_ID, channel: "email", body: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("body");
  });

  it("rejects a body over the EmailLog schema cap", () => {
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "email",
      body: "x".repeat(50_001),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed replyToLogId rather than ignoring it", () => {
    // Silently dropping it would produce an unthreaded reply that also loses the
    // replied-contact send permit — a confusing half-failure.
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "email",
      body: "hi",
      replyToLogId: "not-an-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("replyToLogId");
  });

  it("carries through a valid replyToLogId, subject and variantKey", () => {
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "email",
      body: "hi",
      subject: "Re: Quick question",
      replyToLogId: LOG_ID,
      variantKey: "email-s1-painpoint",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.subject).toBe("Re: Quick question");
      expect(result.payload.replyToLogId).toBe(LOG_ID);
      expect(result.payload.variantKey).toBe("email-s1-painpoint");
    }
  });

  it("accepts a facebook payload with no subject", () => {
    const result = validateOsDraftPayload({
      contactId: CONTACT_ID,
      channel: "facebook",
      body: "hey, following up",
    });
    expect(result.ok).toBe(true);
  });
});

describe("resolveOsDraftStage", () => {
  it("inherits the replied-to log's stage", () => {
    expect(resolveOsDraftStage(2, 3)).toBe(2);
  });

  it("falls back to the contact's current stage when there is no anchor", () => {
    expect(resolveOsDraftStage(null, 2)).toBe(2);
  });

  it("maps a stage-0 (not yet contacted) contact to stage 1", () => {
    // EmailLog.stage is enum [1,2,3]; Contact.currentStage starts at 0.
    expect(resolveOsDraftStage(null, 0)).toBe(1);
  });

  it("clamps anything above 3 to 3", () => {
    expect(resolveOsDraftStage(9, 0)).toBe(3);
  });

  it("defaults to 1 when both inputs are absent", () => {
    expect(resolveOsDraftStage(undefined, undefined)).toBe(1);
  });
});

describe("deriveOsDraftSubject", () => {
  it("prefers an explicitly supplied subject", () => {
    expect(deriveOsDraftSubject("Custom", "Anchor")).toBe("Custom");
  });

  it("derives Re: from the anchor when no subject is given", () => {
    expect(deriveOsDraftSubject(undefined, "Quick question")).toBe("Re: Quick question");
  });

  it("does not double-prefix an anchor that is already a reply", () => {
    expect(deriveOsDraftSubject(undefined, "Re: Quick question")).toBe("Re: Quick question");
  });

  it("returns an empty string when there is nothing to derive from", () => {
    expect(deriveOsDraftSubject(undefined, null)).toBe("");
  });

  it("caps the derived subject at the schema maximum", () => {
    const derived = deriveOsDraftSubject(undefined, "a".repeat(OS_DRAFT_SUBJECT_MAX));
    expect(derived.length).toBe(OS_DRAFT_SUBJECT_MAX);
  });
});

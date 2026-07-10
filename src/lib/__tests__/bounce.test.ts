/**
 * Unit tests for bounce-detection pure helpers.
 *
 * isInvalidRecipientError — src/lib/sequence.ts (send-time classifier)
 * isBounceMessage         — src/lib/replies.ts  (poll-time classifier)
 *
 * Both functions are conservative: doubt → false → normal retry / skip path.
 */

import { describe, it, expect } from "vitest";
import { isInvalidRecipientError } from "@/lib/sequence";
import { isBounceMessage } from "@/lib/replies";

// ---------------------------------------------------------------------------
// isInvalidRecipientError — send-time classifier
// ---------------------------------------------------------------------------

describe("isInvalidRecipientError", () => {
  // ---------------------------------------------------------------------------
  // Should return true — unambiguous invalid-recipient errors
  // ---------------------------------------------------------------------------

  it("returns true for HTTP 400 invalidArgument with 'recipient' in message", () => {
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument", message: "Invalid recipient address" }],
      message: "Bad Request: Invalid recipient address",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 400 invalidArgument with 'address' in message", () => {
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument", message: "Invalid email address" }],
      message: "Bad Request: Invalid email address",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 400 invalidArgument with 'invalid to' in message", () => {
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument" }],
      message: "invalid to header",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 400 invalidArgument with 'no such user' in message", () => {
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument" }],
      message: "No such user: badaddr@example.com",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 404 notFound with 'address' in message", () => {
    const err = {
      code: 404,
      errors: [{ reason: "notFound" }],
      message: "Address not found: ghost@example.com",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 404 notFound with 'recipient' in message", () => {
    const err = {
      code: 404,
      errors: [{ reason: "notFound" }],
      message: "Recipient does not exist",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 404 notFound with 'user not found' in message", () => {
    const err = {
      code: 404,
      errors: [{ reason: "notFound" }],
      message: "User not found",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("returns true for HTTP 404 notFound with 'mailbox not found' in message", () => {
    const err = {
      code: 404,
      errors: [{ reason: "notFound" }],
      message: "Mailbox not found for ghost@dead.example.com",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("is case-insensitive for message text", () => {
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument" }],
      message: "INVALID RECIPIENT ADDRESS",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  it("handles err.status field instead of err.code", () => {
    const err = {
      status: 400,
      errors: [{ reason: "invalidArgument" }],
      message: "Invalid recipient",
    };
    expect(isInvalidRecipientError(err)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Should return false — non-bounce errors must not be mis-classified
  // ---------------------------------------------------------------------------

  it("returns false for HTTP 429 quota exceeded (not a bounce)", () => {
    const err = {
      code: 429,
      errors: [{ reason: "rateLimitExceeded" }],
      message: "User-rate-limit exceeded. Retry after 30 seconds.",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 401 auth error (not a bounce)", () => {
    const err = {
      code: 401,
      errors: [{ reason: "authError" }],
      message: "Invalid Credentials",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 403 forbidden (not a bounce)", () => {
    const err = {
      code: 403,
      errors: [{ reason: "forbidden" }],
      message: "Insufficient Permission",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 500 transient server error (not a bounce)", () => {
    const err = {
      code: 500,
      errors: [{ reason: "backendError" }],
      message: "Backend Error",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 503 service unavailable (not a bounce)", () => {
    const err = {
      code: 503,
      errors: [],
      message: "Service Unavailable",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 400 without recipient keywords in message", () => {
    // 400 invalidArgument about a bad threadId, not the recipient address
    const err = {
      code: 400,
      errors: [{ reason: "invalidArgument" }],
      message: "Invalid threadId supplied",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 400 with recipient keywords but wrong reason", () => {
    // 400 with recipient in message but NOT invalidArgument reason → not a bounce
    const err = {
      code: 400,
      errors: [{ reason: "badRequest" }],
      message: "Invalid recipient address",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for HTTP 404 with notFound reason but no address keywords", () => {
    // 404 notFound but about a label, not a recipient
    const err = {
      code: 404,
      errors: [{ reason: "notFound" }],
      message: "Label not found",
    };
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for null input", () => {
    expect(isInvalidRecipientError(null)).toBe(false);
  });

  it("returns false for undefined input", () => {
    expect(isInvalidRecipientError(undefined)).toBe(false);
  });

  it("returns false for a plain Error object with no code", () => {
    const err = new Error("network timeout");
    expect(isInvalidRecipientError(err)).toBe(false);
  });

  it("returns false for a string error", () => {
    expect(isInvalidRecipientError("Invalid recipient")).toBe(false);
  });

  it("returns false when errors array is empty and no reason found", () => {
    const err = {
      code: 400,
      errors: [],
      message: "Invalid recipient address",
    };
    // No reason found in empty errors array → false
    expect(isInvalidRecipientError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBounceMessage — poll-time classifier
// ---------------------------------------------------------------------------

describe("isBounceMessage", () => {
  // ---------------------------------------------------------------------------
  // Should return true — genuine bounce NDR messages
  // ---------------------------------------------------------------------------

  it("returns true for mailer-daemon From with contact email in body", () => {
    expect(
      isBounceMessage(
        "mailer-daemon@googlemail.com",
        "Delivery failed for user@example.com: no such user",
        "user@example.com"
      )
    ).toBe(true);
  });

  it("returns true for MAILER-DAEMON From (case-insensitive)", () => {
    expect(
      isBounceMessage(
        "MAILER-DAEMON@mail.server.com",
        "Could not deliver to recipient@biz.ph",
        "recipient@biz.ph"
      )
    ).toBe(true);
  });

  it("returns true for postmaster From with contact email in body", () => {
    expect(
      isBounceMessage(
        "postmaster@example.com",
        "This message could not be delivered to contact@shop.ph",
        "contact@shop.ph"
      )
    ).toBe(true);
  });

  it("returns true for Postmaster From (mixed case)", () => {
    expect(
      isBounceMessage(
        "Postmaster@smtp.example.com",
        "Undeliverable: email to owner@store.ph",
        "owner@store.ph"
      )
    ).toBe(true);
  });

  it("is case-insensitive for contact email in body", () => {
    // Body has uppercase email, contactEmail is lowercase — still matches
    expect(
      isBounceMessage(
        "mailer-daemon@gmail.com",
        "Failed delivery to CONTACT@EXAMPLE.COM",
        "contact@example.com"
      )
    ).toBe(true);
  });

  it("matches when contact email appears anywhere in body text", () => {
    expect(
      isBounceMessage(
        "mailer-daemon@mx.example.com",
        "We have been unable to deliver your message after multiple retries.\nFinal recipient: badaddr@target.ph\nReason: mailbox does not exist.",
        "badaddr@target.ph"
      )
    ).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Should return false — non-bounce messages
  // ---------------------------------------------------------------------------

  it("returns false when From is not mailer-daemon or postmaster", () => {
    expect(
      isBounceMessage(
        "support@example.com",
        "Sorry, your email could not be delivered to user@example.com",
        "user@example.com"
      )
    ).toBe(false);
  });

  it("returns false when body does not contain contact email", () => {
    // From is mailer-daemon but body doesn't mention this contact's email
    expect(
      isBounceMessage(
        "mailer-daemon@gmail.com",
        "Delivery failed for someoneelse@other.com: mailbox full",
        "contact@example.com"
      )
    ).toBe(false);
  });

  it("returns false for an empty From header", () => {
    expect(
      isBounceMessage(
        "",
        "Delivery failure for user@example.com",
        "user@example.com"
      )
    ).toBe(false);
  });

  it("returns false for normal reply From containing 'mailer' in company name", () => {
    // Edge case: a company with 'mailer' in the email but not 'mailer-daemon'
    expect(
      isBounceMessage(
        "info@bestmailer.ph",
        "Thanks for your email, user@example.com",
        "user@example.com"
      )
    ).toBe(false);
  });

  it("returns false when body is empty even if From is mailer-daemon", () => {
    expect(
      isBounceMessage(
        "mailer-daemon@example.com",
        "",
        "user@example.com"
      )
    ).toBe(false);
  });

  it("does not match a partial email address (subdomain-only)", () => {
    // Body contains "example.com" but not the full email "user@example.com"
    expect(
      isBounceMessage(
        "mailer-daemon@example.com",
        "Delivery failure to the host example.com",
        "user@example.com"
      )
    ).toBe(false);
  });
});

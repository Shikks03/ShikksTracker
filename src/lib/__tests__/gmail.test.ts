/**
 * Unit tests for buildRawMessage in src/lib/gmail.ts.
 *
 * buildRawMessage is a pure function — it constructs a base64url-encoded
 * RFC-2822 message. No Gmail API calls are made.
 *
 * Importing the module pulls in `googleapis` but no env assertions run at
 * import time; only getGmailClient() triggers env checks, so importing
 * buildRawMessage alone is safe.
 *
 * Covers: RFC 2047 subject encoding (non-ASCII), ASCII subjects (no encoding),
 * threading headers (In-Reply-To, References), base64url round-trip,
 * MIME structure, and CRLF line endings.
 */

import { describe, it, expect } from "vitest";
import { buildRawMessage } from "@/lib/gmail";

// ---------------------------------------------------------------------------
// Helper: decode base64url → string
// ---------------------------------------------------------------------------

function decodeBase64url(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf-8");
}

// ---------------------------------------------------------------------------
// Base64url round-trip
// ---------------------------------------------------------------------------

describe("buildRawMessage — base64url encoding", () => {
  it("returns a non-empty base64url string", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Hello",
      htmlBody: "<p>Test</p>",
    });
    expect(raw).toBeTruthy();
    expect(typeof raw).toBe("string");
    // base64url uses A-Z a-z 0-9 - _ (no + / = padding)
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("decoded output contains expected To header", () => {
    const raw = buildRawMessage({
      to: "recipient@example.com",
      from: "sender@example.com",
      subject: "Test",
      htmlBody: "<p>Body</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("To: recipient@example.com");
  });

  it("decoded output contains expected From header", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "sender@example.com",
      subject: "Test",
      htmlBody: "<p>Body</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("From: sender@example.com");
  });

  it("decoded output contains the HTML body", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Test",
      htmlBody: "<p>Hello world!</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("<p>Hello world!</p>");
  });
});

// ---------------------------------------------------------------------------
// ASCII subjects — no encoding needed
// ---------------------------------------------------------------------------

describe("buildRawMessage — ASCII subject (no RFC 2047 encoding)", () => {
  it("uses the subject verbatim when it contains only ASCII", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Quick question for Acme Corp",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("Subject: Quick question for Acme Corp");
  });

  it("does not RFC 2047-encode a pure ASCII subject", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Hello World",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    // RFC 2047 encoded form starts with =?UTF-8?B?
    expect(decoded).not.toContain("=?UTF-8?B?");
  });
});

// ---------------------------------------------------------------------------
// Non-ASCII subjects — RFC 2047 encoding
// ---------------------------------------------------------------------------

describe("buildRawMessage — non-ASCII subject (RFC 2047)", () => {
  it("RFC 2047-encodes a subject with a non-ASCII character", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Kumusta ka? 🙂",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    // Must use RFC 2047 encoding
    expect(decoded).toContain("=?UTF-8?B?");
    expect(decoded).toContain("?=");
  });

  it("RFC 2047-encoded subject decodes back to the original text", () => {
    const originalSubject = "Magandang araw! ✨ Tagalog greeting";
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: originalSubject,
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);

    // Extract the encoded subject from the Subject: header line
    const subjectMatch = decoded.match(/^Subject: (.+)$/m);
    expect(subjectMatch).not.toBeNull();
    const encodedSubjectValue = subjectMatch![1];

    // Verify RFC 2047 structure: =?UTF-8?B?<base64>?=
    expect(encodedSubjectValue).toMatch(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);

    // Decode the inner base64 and verify it matches the original
    const innerBase64Match = encodedSubjectValue.match(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/);
    expect(innerBase64Match).not.toBeNull();
    const innerDecoded = Buffer.from(innerBase64Match![1], "base64").toString("utf-8");
    expect(innerDecoded).toBe(originalSubject);
  });

  it("encodes subject with accented characters (common in Filipino names)", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Re: Añong balita?",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("=?UTF-8?B?");
  });
});

// ---------------------------------------------------------------------------
// Threading headers
// ---------------------------------------------------------------------------

describe("buildRawMessage — threading headers", () => {
  it("includes In-Reply-To when provided", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Re: Original",
      htmlBody: "<p>Follow-up</p>",
      inReplyTo: "<msg-001@mail.gmail.com>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("In-Reply-To: <msg-001@mail.gmail.com>");
  });

  it("includes References when provided", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Re: Original",
      htmlBody: "<p>Follow-up</p>",
      references: "<msg-001@mail.gmail.com> <msg-002@mail.gmail.com>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain(
      "References: <msg-001@mail.gmail.com> <msg-002@mail.gmail.com>"
    );
  });

  it("includes both In-Reply-To and References when both provided", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Re: Original",
      htmlBody: "<p>Follow-up</p>",
      inReplyTo: "<msg-002@mail.gmail.com>",
      references: "<msg-001@mail.gmail.com> <msg-002@mail.gmail.com>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("In-Reply-To: <msg-002@mail.gmail.com>");
    expect(decoded).toContain(
      "References: <msg-001@mail.gmail.com> <msg-002@mail.gmail.com>"
    );
  });

  it("omits In-Reply-To when not provided", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Initial Email",
      htmlBody: "<p>First message</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).not.toContain("In-Reply-To:");
  });

  it("omits References when not provided", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Initial Email",
      htmlBody: "<p>First message</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).not.toContain("References:");
  });
});

// ---------------------------------------------------------------------------
// MIME structure
// ---------------------------------------------------------------------------

describe("buildRawMessage — MIME structure", () => {
  it("includes MIME-Version: 1.0 header", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("MIME-Version: 1.0");
  });

  it("includes Content-Type: text/html; charset=UTF-8 header", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
  });

  it("uses CRLF as the line separator between headers", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Test",
      htmlBody: "<p>Hi</p>",
    });
    const decoded = decodeBase64url(raw);
    // RFC 2822 requires CRLF
    expect(decoded).toContain("\r\n");
  });

  it("separates headers from body with blank CRLF line", () => {
    const raw = buildRawMessage({
      to: "to@example.com",
      from: "from@example.com",
      subject: "Test",
      htmlBody: "<p>The body</p>",
    });
    const decoded = decodeBase64url(raw);
    // Headers end with \r\n\r\n before body
    expect(decoded).toContain("\r\n\r\n<p>The body</p>");
  });
});

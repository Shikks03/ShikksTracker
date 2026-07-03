import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local and restart the dev server.`
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Gmail client factory
// ---------------------------------------------------------------------------

export function getGmailClient(): gmail_v1.Gmail {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const refreshToken = requireEnv("GOOGLE_REFRESH_TOKEN");

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth });
}

// ---------------------------------------------------------------------------
// Sender address cache (module-level, per-process)
// ---------------------------------------------------------------------------

let _cachedSenderAddress: string | null = null;

export async function getSenderAddress(gmail: gmail_v1.Gmail): Promise<string> {
  if (_cachedSenderAddress) return _cachedSenderAddress;

  const { data } = await gmail.users.getProfile({ userId: "me" });
  const email = data.emailAddress;
  if (!email) {
    throw new Error("Gmail API returned no emailAddress in users.getProfile response.");
  }

  _cachedSenderAddress = email;
  return email;
}

// ---------------------------------------------------------------------------
// RFC-2822 message builder
// ---------------------------------------------------------------------------

interface BuildRawMessageOpts {
  to: string;
  from: string;
  subject: string;
  htmlBody: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * Builds a base64url-encoded RFC-2822 message suitable for the Gmail API.
 * Subject is RFC 2047 encoded when it contains non-ASCII characters.
 */
export function buildRawMessage(opts: BuildRawMessageOpts): string {
  const { to, from, subject, htmlBody, inReplyTo, references } = opts;

  // RFC 2047 UTF-8 base64 encode subject if it contains non-ASCII characters
  const needsEncoding = /[^\x00-\x7F]/.test(subject);
  const encodedSubject = needsEncoding
    ? `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`
    : subject;

  const lines: string[] = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ];

  if (inReplyTo) {
    lines.push(`In-Reply-To: ${inReplyTo}`);
  }
  if (references) {
    lines.push(`References: ${references}`);
  }

  lines.push("", htmlBody);

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

// ---------------------------------------------------------------------------
// High-level send function
// ---------------------------------------------------------------------------

interface SendGmailMessageOpts {
  to: string;
  subject: string;
  htmlBody: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

interface SendGmailMessageResult {
  messageId: string;
  threadId: string;
}

export async function sendGmailMessage(
  opts: SendGmailMessageOpts
): Promise<SendGmailMessageResult> {
  const { to, subject, htmlBody, threadId, inReplyTo, references } = opts;

  const gmail = getGmailClient();
  const from = await getSenderAddress(gmail);

  const raw = buildRawMessage({ to, from, subject, htmlBody, inReplyTo, references });

  const requestBody: gmail_v1.Schema$Message = { raw };
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const { data } = await gmail.users.messages.send({
    userId: "me",
    requestBody,
  });

  if (!data.id || !data.threadId) {
    throw new Error("Gmail API send response missing id or threadId.");
  }

  return { messageId: data.id, threadId: data.threadId };
}

// ---------------------------------------------------------------------------
// Throttling utilities (used by sequence engine)
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomDelayMs(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

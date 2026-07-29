import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftInput {
  /** Campaign.offerSummary */
  offerSummary: string;
  /** Campaign.toneNotes */
  toneNotes: string;
  businessName: string;
  contactName?: string;
  /** User's personalization notes for this contact (Contact.keyPoints) */
  keyPoints: string;
  /** 1 = initial outreach, 2 = follow-up 1, 3 = follow-up 2 */
  stage: 1 | 2 | 3;
  /** Earlier email touches, used for follow-up continuity */
  previousEmails?: { subject: string; body: string }[];
  /**
   * The draft that was rejected by the reviewer. When present (alongside
   * `feedback`), `buildUserMessage` appends a clearly-delimited rejection
   * section so Claude does not repeat the same content.
   */
  previousAttempt?: { subject: string; body: string };
  /**
   * Optional human feedback explaining why the previous draft was rejected.
   * Only used when `previousAttempt` is also provided.
   */
  feedback?: string;
  /**
   * Outreach channel this draft is for. Defaults to "email" when omitted —
   * every existing caller (pre multi-channel) implicitly means email, and
   * that path must stay byte-identical to before this field existed.
   */
  channel?: "email" | "facebook" | "instagram" | "phone";
}

// ---------------------------------------------------------------------------
// Forced-tool-use draft generation
// ---------------------------------------------------------------------------

let _anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable AI draft generation."
    );
  }
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

const MODEL =
  (process.env.ANTHROPIC_MODEL as string | undefined) ?? "claude-sonnet-4-6";

/** System prompt instructing Claude how to write outreach emails. */
export const SYSTEM_PROMPT = `You are a cold outreach specialist writing short, human-feeling outreach emails for Philippine small businesses.

RULES — follow every one, no exceptions:
1. Under ~120 words. Plain text only. Paragraphs separated by a blank line. No HTML, no markdown, no bullet lists.
2. No placeholders such as [Name], [Company], [Your Name], etc. Use the names you are given or omit them gracefully.
3. Open with something SPECIFIC to the business (from keyPoints). NEVER open with "I hope this email finds you well" or any generic opener.
4. Reference the keyPoints naturally in the body — the email must feel like it was written for this specific business, not a template.
5. Respect toneNotes. If toneNotes says formal, be formal. If casual, be casual.
6. No spammy phrasing: no ALL CAPS words, no "limited time offer", no exclamation-heavy hype (at most one "!" in the whole email).
7. Stage awareness:
   - Stage 1 (initial): pitch the offer clearly using offerSummary.
   - Stage 2–3 (follow-ups): shorter than the initial email. Reference the previous email(s) briefly. Add one new angle or gentle nudge. NEVER guilt-trip.
   - Stage 2–3 subjects: must read as a natural thread continuation (e.g. "Re: Quick question for [Business]" or similar).
8. Warm and direct tone. English is fine; keep it natural for a Philippine business audience.

Use the email_draft tool to return your result.`;

/**
 * System prompt for Facebook/Instagram DM drafting. This is NOT an email —
 * no subject line, no salutation block ("Dear X,"), no email sign-off
 * ("Best regards," etc.). It will be pasted directly into a Facebook/Instagram
 * DM composer box, so it must read like a short, casual direct message.
 *
 * Exported (like TEMPLATE_SYSTEM_PROMPT) so it's testable and easy to
 * hand-tune independently of the email prompt.
 */
export const SOCIAL_DM_SYSTEM_PROMPT = `You are writing a short, casual Facebook/Instagram direct message for outreach to a Philippine small business. This text will be pasted directly into a Facebook or Instagram DM box — it is NOT an email.

RULES — follow every one, no exceptions:
1. Under ~60 words. 1–2 short paragraphs. Plain text only — no HTML, no markdown, no bullet lists.
2. NO subject line. NO salutation block (no "Dear X," / "Hi X," on its own line). NO email sign-off (no "Best regards," "Sincerely," etc.). Write it the way a real person types a DM — it can still open with a quick greeting worked into the first sentence, but not as a formal letter opener.
3. Open with something SPECIFIC to the business, drawn from keyPoints. NEVER open with a generic greeting alone.
4. One clear, low-friction ask (e.g. "mind if I send over a quick idea?", "worth a quick chat?"). Do not ask for more than one thing.
5. At most one "!" in the whole message. No ALL CAPS words. No link spam (at most one link, only if truly necessary).
6. Respect toneNotes — but keep it casual and conversational regardless, since this is a DM, not a letter.
7. Warm, direct, and natural for a Philippine small-business audience — like a real person reaching out, not a bot.
8. Stage awareness:
   - Stage 1 (initial): a friendly first touch referencing something specific about the business, then the one low-friction ask.
   - Stage 2–3 (follow-ups): even shorter than the initial message. A brief, casual nudge — reference the earlier message lightly. Never guilt-trip, never repeat the whole pitch.

Use the message_draft tool to return your result — body only, no subject.`;

/**
 * System prompt for a phone call opening script. This is spoken language the
 * user reads aloud when the contact picks up — NOT written/email register.
 *
 * Exported (like TEMPLATE_SYSTEM_PROMPT) so it's testable and easy to
 * hand-tune independently of the email prompt.
 */
export const PHONE_SCRIPT_SYSTEM_PROMPT = `You are writing a short phone call opening script for outreach to a Philippine small business. The user will READ THIS ALOUD when the contact answers the phone — it must sound like natural spoken language, not written prose or an email.

RULES — follow every one, no exceptions:
1. Under ~80 words.
2. Spoken register: contractions are good ("I'm", "we're", "you're"). Short sentences. No email formatting, no bullet points, no "Dear"/"Best regards" — this is a script to be spoken, not read.
3. Structure, in order:
   a. A one-line self-introduction (who's calling, in one breath).
   b. A specific reason for calling, drawn from keyPoints — something concrete about this business, not a generic pitch.
   c. One permission-asking question near the end (e.g. "Do you have 30 seconds?" or "Is now an okay time?") — never launch straight into the full pitch.
4. Warm, direct, conversational tone — like a real person calling, not reading a script off a card (even though they are).
5. No spammy phrasing, no ALL CAPS, no hype language, at most one "!" if any.
6. Respect toneNotes where it doesn't conflict with sounding natural when spoken aloud.
7. Stage awareness:
   - Stage 1 (initial): a first call — introduce, give the specific reason, ask permission to continue.
   - Stage 2–3 (follow-ups): a shorter callback opener — briefly reference the earlier attempt/message, then the permission question.

Use the message_draft tool to return your result — body only, no subject.`;

export function buildUserMessage(input: DraftInput): string {
  const lines: string[] = [
    `Business name: ${input.businessName}`,
    `Contact name: ${input.contactName ?? "(not provided)"}`,
    `Stage: ${input.stage} (${input.stage === 1 ? "initial outreach" : input.stage === 2 ? "follow-up 1" : "follow-up 2"})`,
    `Offer summary: ${input.offerSummary}`,
    `Tone notes: ${input.toneNotes || "(none — default to professional and warm)"}`,
    `Key points / personalization notes: ${input.keyPoints}`,
  ];

  if (
    input.stage > 1 &&
    input.previousEmails &&
    input.previousEmails.length > 0
  ) {
    lines.push("\nPrevious email(s) sent to this contact:");
    for (const [i, prev] of input.previousEmails.entries()) {
      lines.push(`\n--- Email ${i + 1} ---`);
      lines.push(`Subject: ${prev.subject}`);
      lines.push(`Body:\n${prev.body}`);
    }
  }

  if (input.previousAttempt) {
    lines.push(
      "\n--- REJECTED DRAFT (do NOT repeat this) ---",
      `The previous draft attempt was REJECTED.`,
      `Rejected subject: ${input.previousAttempt.subject}`,
      `Rejected body:\n${input.previousAttempt.body}`,
    );
    if (input.feedback) {
      lines.push(`Reason for rejection: ${input.feedback}`);
    }
    lines.push(
      `Write a NEW draft addressing ${input.feedback ? "the feedback above" : "the reviewer's concerns"} — do not repeat the rejected version.`,
      "--- END REJECTED DRAFT ---",
    );
  }

  return lines.join("\n");
}

/**
 * Builds the user-turn message for non-email channels (facebook/instagram/phone).
 *
 * Kept as a separate function rather than adding branches to `buildUserMessage`
 * because `buildUserMessage`'s output is unit-tested byte-for-byte for the
 * email path — threading a channel branch through it risks an accidental
 * change to that output. A dedicated builder makes each path easy to read,
 * easy to test in isolation, and impossible to cross-contaminate.
 *
 * Deliberately omits email-specific framing (no "Subject:"-shaped framing,
 * previous touches are called "message(s)" rather than "email(s)") and states
 * the channel explicitly so the model doesn't default to email register.
 */
export function buildChannelUserMessage(
  input: DraftInput & { channel: "facebook" | "instagram" | "phone" }
): string {
  const channelLabel =
    input.channel === "phone"
      ? "Phone call"
      : input.channel === "facebook"
      ? "Facebook DM"
      : "Instagram DM";

  const lines: string[] = [
    `Channel: ${channelLabel}`,
    `Business name: ${input.businessName}`,
    `Contact name: ${input.contactName ?? "(not provided)"}`,
    `Stage: ${input.stage} (${input.stage === 1 ? "initial outreach" : input.stage === 2 ? "follow-up 1" : "follow-up 2"})`,
    `Offer summary: ${input.offerSummary}`,
    `Tone notes: ${input.toneNotes || "(none — default to professional and warm)"}`,
    `Key points / personalization notes: ${input.keyPoints}`,
  ];

  if (
    input.stage > 1 &&
    input.previousEmails &&
    input.previousEmails.length > 0
  ) {
    lines.push("\nPrevious message(s) sent to this contact:");
    for (const [i, prev] of input.previousEmails.entries()) {
      lines.push(`\n--- Message ${i + 1} ---`);
      lines.push(prev.body);
    }
  }

  if (input.previousAttempt) {
    lines.push(
      "\n--- REJECTED DRAFT (do NOT repeat this) ---",
      `The previous draft attempt was REJECTED.`,
      `Rejected message:\n${input.previousAttempt.body}`,
    );
    if (input.feedback) {
      lines.push(`Reason for rejection: ${input.feedback}`);
    }
    lines.push(
      `Write a NEW draft addressing ${input.feedback ? "the feedback above" : "the reviewer's concerns"} — do not repeat the rejected version.`,
      "--- END REJECTED DRAFT ---",
    );
  }

  return lines.join("\n");
}

/**
 * Generates a cold-outreach draft using Claude via forced tool use.
 *
 * Branches on `input.channel` (defaults to "email" when omitted):
 *   - "email": UNCHANGED from before this field existed — same SYSTEM_PROMPT,
 *     same `email_draft` tool schema, same validation (empty subject AND empty
 *     body both throw).
 *   - "facebook" | "instagram" | "phone": a channel-specific system prompt and
 *     a separate `message_draft` tool whose schema requires only `body` (no
 *     subject field at all — asking for one and discarding it would waste
 *     tokens and risk the model leaking email framing into the body). Returns
 *     `{ subject: "", body }`; only the empty-body check runs (the email
 *     path's empty-subject check would always throw here, since there is no
 *     subject to fill).
 */
export async function generateEmailDraft(
  input: DraftInput
): Promise<{ subject: string; body: string }> {
  const client = getClient();
  const channel = input.channel ?? "email";

  if (channel === "email") {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: "email_draft",
          description:
            "Return the generated cold outreach email as structured JSON with subject and body fields.",
          input_schema: {
            type: "object" as const,
            properties: {
              subject: {
                type: "string",
                description: "The email subject line.",
              },
              body: {
                type: "string",
                description:
                  "The plain-text email body. Paragraphs separated by blank lines (\\n\\n). No HTML or markdown.",
              },
            },
            required: ["subject", "body"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: "tool", name: "email_draft" },
      messages: [{ role: "user", content: buildUserMessage(input) }],
    });

    // Extract the tool_use block from Claude's response
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error(
        `generateEmailDraft: expected a tool_use block from Claude but received: ${JSON.stringify(response.content)}`
      );
    }

    const input_data = toolBlock.input as Record<string, unknown>;
    const subject =
      typeof input_data.subject === "string" ? input_data.subject.trim() : "";
    const body =
      typeof input_data.body === "string" ? input_data.body.trim() : "";

    if (!subject) {
      throw new Error(
        "generateEmailDraft: Claude returned an empty subject. Check the prompt or model output."
      );
    }
    if (!body) {
      throw new Error(
        "generateEmailDraft: Claude returned an empty body. Check the prompt or model output."
      );
    }

    return { subject, body };
  }

  // Non-email channels: facebook / instagram / phone.
  const systemPrompt =
    channel === "phone" ? PHONE_SCRIPT_SYSTEM_PROMPT : SOCIAL_DM_SYSTEM_PROMPT;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    tools: [
      {
        name: "message_draft",
        description:
          channel === "phone"
            ? "Return the generated phone call opening script as structured JSON with a body field."
            : "Return the generated Facebook/Instagram DM as structured JSON with a body field.",
        input_schema: {
          type: "object" as const,
          properties: {
            body: {
              type: "string",
              description:
                channel === "phone"
                  ? "The plain-text call script the user will read aloud. No email formatting."
                  : "The plain-text DM body. No subject line, no salutation block, no email sign-off.",
            },
          },
          required: ["body"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "message_draft" },
    messages: [
      {
        role: "user",
        content: buildChannelUserMessage({ ...input, channel }),
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error(
      `generateEmailDraft: expected a tool_use block from Claude but received: ${JSON.stringify(response.content)}`
    );
  }

  const input_data = toolBlock.input as Record<string, unknown>;
  const body =
    typeof input_data.body === "string" ? input_data.body.trim() : "";

  if (!body) {
    throw new Error(
      "generateEmailDraft: Claude returned an empty body. Check the prompt or model output."
    );
  }

  return { subject: "", body };
}

// Plain-text → HTML rendering lives in tracking.ts (`renderTrackedHtml`).
// Call `renderTrackedHtml(body, [], null)` for the untracked HTML representation
// that this module previously exposed as `bodyToHtml` (removed 2026-07-11,
// Task 5.4 — the two implementations were duplicated and would drift).

// ---------------------------------------------------------------------------
// Template generation (reusable boilerplate — placeholders PRESERVED)
//
// Distinct from generateEmailDraft above: that produces a finished, per-contact
// email and FORBIDS placeholders. This produces a reusable TEMPLATE and REQUIRES
// {{businessName}} / {{contactName}} tokens so it can be reused across contacts.
//
// NOTE: TEMPLATE_SYSTEM_PROMPT is an intentional first-pass — expected to be
// hand-tuned by the user. Keep it isolated and easy to edit.
// ---------------------------------------------------------------------------

export interface TemplateDraftInput {
  /** Short free-text description of the template's purpose/offer. */
  brief: string;
  /** Optional tone/voice notes (mirrors Campaign.toneNotes shape). */
  tone?: string;
}

/** System prompt for reusable-template generation. First-pass; user will tune. */
export const TEMPLATE_SYSTEM_PROMPT = `You are a cold outreach specialist writing REUSABLE email TEMPLATES for Philippine small businesses. Your output will be saved once and reused across many different businesses, so it must be written with placeholder tokens rather than any specific business or person.

RULES — follow every one, no exceptions:
1. Under ~120 words. Plain text only. Paragraphs separated by a blank line. No HTML, no markdown, no bullet lists.
2. This is a TEMPLATE, not a finished email. Where the recipient's business name belongs, write the exact token {{businessName}}. Where a first name belongs, write the exact token {{contactName}}. Write these tokens EXACTLY, with double curly braces — never real names, never square-bracket placeholders like [Name].
3. Use {{contactName}} sparingly and only where it reads naturally (at send time a friendly fallback is substituted when a contact has no name). {{businessName}} may appear once or twice where natural.
4. Open with something that will feel specific once {{businessName}} is filled in. NEVER open with "I hope this email finds you well" or any generic opener.
5. Respect the tone notes. If they say formal, be formal; if casual, be casual.
6. No spammy phrasing: no ALL CAPS words, no "limited time offer", at most one "!" in the whole email.
7. Warm and direct tone, natural for a Philippine small-business audience.

Use the email_draft tool to return your result.`;

/** Builds the user-turn message for template generation. Pure + testable. */
export function buildTemplateUserMessage(input: TemplateDraftInput): string {
  const tone =
    input.tone && input.tone.trim()
      ? input.tone
      : "(none — default to professional and warm)";
  return [`Brief: ${input.brief}`, `Tone notes: ${tone}`].join("\n");
}

/**
 * Generates a reusable email TEMPLATE (subject + body with placeholders) using
 * Claude via forced tool use. Structured output is guaranteed. Does not persist.
 */
export async function generateTemplateDraft(
  input: TemplateDraftInput
): Promise<{ subject: string; body: string }> {
  const client = getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: TEMPLATE_SYSTEM_PROMPT,
    tools: [
      {
        name: "email_draft",
        description:
          "Return the generated reusable email template as structured JSON with subject and body fields.",
        input_schema: {
          type: "object" as const,
          properties: {
            subject: {
              type: "string",
              description:
                "The template subject line. May contain {{businessName}} / {{contactName}} tokens.",
            },
            body: {
              type: "string",
              description:
                "The plain-text template body with {{businessName}} / {{contactName}} tokens. Paragraphs separated by blank lines (\\n\\n). No HTML or markdown.",
            },
          },
          required: ["subject", "body"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "email_draft" },
    messages: [{ role: "user", content: buildTemplateUserMessage(input) }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error(
      `generateTemplateDraft: expected a tool_use block from Claude but received: ${JSON.stringify(response.content)}`
    );
  }

  const input_data = toolBlock.input as Record<string, unknown>;
  const subject =
    typeof input_data.subject === "string" ? input_data.subject.trim() : "";
  const body =
    typeof input_data.body === "string" ? input_data.body.trim() : "";

  if (!subject) {
    throw new Error(
      "generateTemplateDraft: Claude returned an empty subject. Check the prompt or model output."
    );
  }
  if (!body) {
    throw new Error(
      "generateTemplateDraft: Claude returned an empty body. Check the prompt or model output."
    );
  }

  return { subject, body };
}

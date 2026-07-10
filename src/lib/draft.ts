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
const SYSTEM_PROMPT = `You are a cold outreach specialist writing short, human-feeling outreach emails for Philippine small businesses.

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
8. Always end with a one-line opt-out note on its own line, e.g. "If you'd rather not hear from me, just reply STOP."
9. Warm and direct tone. English is fine; keep it natural for a Philippine business audience.

Use the email_draft tool to return your result.`;

function buildUserMessage(input: DraftInput): string {
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

  return lines.join("\n");
}

/**
 * Generates a cold-outreach email draft using Claude via forced tool use.
 * The model MUST call the `email_draft` tool — structured output is guaranteed.
 */
export async function generateEmailDraft(
  input: DraftInput
): Promise<{ subject: string; body: string }> {
  const client = getClient();

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

// Plain-text → HTML rendering lives in tracking.ts (`renderTrackedHtml`).
// Call `renderTrackedHtml(body, [], null)` for the untracked HTML representation
// that this module previously exposed as `bodyToHtml` (removed 2026-07-11,
// Task 5.4 — the two implementations were duplicated and would drift).

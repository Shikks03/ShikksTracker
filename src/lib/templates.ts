/**
 * templates.ts — Pure validation helper for template CRUD.
 *
 * Extracted from the route handler so the logic is unit-testable
 * without a DB or Next.js context.
 */

export interface TemplateFields {
  name: string;
  subject: string;
  body: string;
}

export interface TemplateValidationError {
  field: string;
  message: string;
}

/**
 * Validate and normalise template POST body.
 *
 * Returns `{ ok: true, fields }` with trimmed values on success, or
 * `{ ok: false, error }` with a human-readable message on failure.
 */
export function validateTemplateBody(
  raw: Record<string, unknown>
): { ok: true; fields: TemplateFields } | { ok: false; error: string } {
  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    return { ok: false, error: "name is required" };
  }
  if (typeof raw.subject !== "string" || raw.subject.trim() === "") {
    return { ok: false, error: "subject is required" };
  }
  if (typeof raw.body !== "string" || raw.body.trim() === "") {
    return { ok: false, error: "body is required" };
  }
  return {
    ok: true,
    fields: {
      name:    raw.name.trim(),
      subject: raw.subject.trim(),
      body:    raw.body.trim(),
    },
  };
}

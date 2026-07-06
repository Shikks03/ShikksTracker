export interface PlaceholderContact {
  businessName: string;
  contactName?: string | null;
}

/**
 * Replaces {{businessName}} and {{contactName}} tokens with the contact's
 * values. Internal whitespace inside the braces is tolerated
 * (e.g. "{{ contactName }}"). contactName falls back to "there" when the
 * contact has no name. Any other {{...}} token is left untouched.
 *
 * Used for manual multi-contact compose personalization. Applied to both
 * subject and body by the caller.
 */
export function applyPlaceholders(text: string, contact: PlaceholderContact): string {
  const name =
    contact.contactName && contact.contactName.trim()
      ? contact.contactName.trim()
      : "there";

  return text.replace(
    /\{\{\s*(businessName|contactName)\s*\}\}/g,
    (_match, token: string) =>
      token === "businessName" ? contact.businessName : name
  );
}

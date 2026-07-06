export interface PlaceholderContact {
  businessName: string;
  contactName?: string | null;
}

/**
 * Replaces {{businessName}} and {{contactName}} tokens with the contact's
 * values. Matching is CASE-INSENSITIVE ({{CONTACTNAME}}, {{ContactName}},
 * {{contactname}} all match) and internal whitespace inside the braces is
 * tolerated (e.g. "{{ contactName }}"). contactName falls back to "there"
 * when the contact has no name. Any other {{...}} token is left untouched.
 *
 * Used for compose personalization. Applied to both subject and body at
 * send time (src/lib/sequence.ts sendOneLog), so it is path-independent —
 * it fills tokens no matter how the email was created.
 */
export function applyPlaceholders(text: string, contact: PlaceholderContact): string {
  const name =
    contact.contactName && contact.contactName.trim()
      ? contact.contactName.trim()
      : "there";

  return text.replace(
    /\{\{\s*(businessName|contactName)\s*\}\}/gi,
    (_match, token: string) =>
      token.toLowerCase() === "businessname" ? contact.businessName : name
  );
}

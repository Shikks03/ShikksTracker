import type { Metadata } from "next";
import LegalLayout, { H2, P, UL, LI } from "@/components/LegalLayout";
import { OPERATOR_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — ShikksTracker",
  description: "Terms governing the ShikksTracker outreach tool.",
};

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      intro={`The terms on which ShikksTracker, operated by ${OPERATOR_NAME}, is provided.`}
    >
      <H2>1. What this is</H2>
      <P>
        ShikksTracker is a private, internal tool operated by {OPERATOR_NAME} to manage
        business-to-business outreach and the conversations that follow. It is not offered to the
        public, sold, licensed, or made available for anyone else to sign up for or use.
      </P>
      <P>
        There is accordingly no user base to address. These terms exist to state plainly what the
        tool does and on what basis it operates.
      </P>

      <H2>2. Access</H2>
      <P>
        Access is restricted to the operator by password. Any attempt to access the dashboard,
        its interfaces, or its underlying data without authorisation is prohibited.
      </P>
      <P>
        Three pages are public and may be read by anyone: this page, the privacy policy, and the
        data deletion page.
      </P>

      <H2>3. How the tool is used</H2>
      <P>The operator commits that this tool is used only to:</P>
      <UL>
        <LI>Contact businesses about a genuine commercial offer, identifying who is writing and why</LI>
        <LI>Include a clear opt-out in every message sent</LI>
        <LI>Honour every opt-out request permanently, whatever words are used to make it — a reply to any email halts the automated sequence before the next send, and a request on any other channel is applied as soon as it is read</LI>
        <LI>Respect the daily sending limits and platform rules of the email and messaging services it connects to</LI>
        <LI>Manage replies received, so that a person answers them</LI>
      </UL>
      <P>
        Messages on Facebook and Instagram are composed by the tool but sent by hand by the
        operator. The tool does not send automated messages on those platforms.
      </P>

      <H2>4. Third-party services</H2>
      <P>
        The tool connects to Google, Meta, Anthropic, MongoDB Atlas and Vercel. Use of those
        services is governed by their own terms, and the operator is responsible for complying with
        them. Nothing here grants any right in those services or their content.
      </P>

      <H2>5. Privacy</H2>
      <P>
        Information about businesses is handled as described in the{" "}
        <a href="/privacy" style={{ color: "#BC5228" }}>privacy policy</a>, which forms part of
        these terms. Deletion requests are handled as described on the{" "}
        <a href="/data-deletion" style={{ color: "#BC5228" }}>data deletion</a> page.
      </P>

      <H2>6. Availability and warranty</H2>
      <P>
        The tool is provided as-is, for the operator&rsquo;s own use, with no warranty of any kind.
        It may be unavailable, changed, or withdrawn at any time without notice.
      </P>

      <H2>7. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, {OPERATOR_NAME} is not liable for any indirect,
        incidental, or consequential loss arising from the operation or unavailability of this
        tool. Nothing in these terms limits any liability that cannot lawfully be limited,
        including rights under the Philippine Data Privacy Act of 2012.
      </P>

      <H2>8. Governing law</H2>
      <P>
        These terms are governed by the laws of the Republic of the Philippines.
      </P>

      <H2>9. Changes</H2>
      <P>
        These terms may be updated; the date at the top of this page reflects the current version.
      </P>

      <H2>10. Contact</H2>
      <P>
        <strong>{CONTACT_EMAIL}</strong>
      </P>
    </LegalLayout>
  );
}

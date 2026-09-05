import type { Metadata } from "next";
import LegalLayout, { H2, P, UL, LI } from "@/components/LegalLayout";
import { OPERATOR_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — ShikksTracker",
  description: "How ShikksTracker collects, uses and deletes business contact data.",
};

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      intro={`How ShikksTracker, operated by ${OPERATOR_NAME}, handles the information it holds.`}
    >
      <H2>What this tool is</H2>
      <P>
        ShikksTracker is a private, single-operator tool used to manage business-to-business
        outreach to small businesses in the Philippines. It is not a public service, it has no
        user accounts, and nobody signs up for it. Only the operator can log in.
      </P>
      <P>
        The people whose information it holds are therefore not users but{" "}
        <strong>business contacts</strong> — businesses that were contacted, or that replied.
        This policy is written for them.
      </P>

      <H2>What information is held</H2>
      <P>Business contact details, gathered from public listings or entered by hand:</P>
      <UL>
        <LI>Business name, category, and general locality</LI>
        <LI>Publicly listed contact details: email address, phone number, website, and Facebook or Instagram handles</LI>
        <LI>A contact person&rsquo;s name, only where the business publishes one</LI>
        <LI>Public listing signals such as star rating, review count, and the text and age of a recent public review</LI>
      </UL>

      <P>Records of contact made and how it was received:</P>
      <UL>
        <LI>The subject and full text of messages sent, and the date sent</LI>
        <LI>Whether an email was opened, and whether a link in it was clicked — measured with a small tracking image and redirect links</LI>
        <LI>Replies received, and the full text of the reply</LI>
        <LI>An internal engagement score derived from the above</LI>
      </UL>

      <P>
        No payment details, government identifiers, precise location, or any special category of
        personal information is collected. No cookies are set on anyone other than the operator,
        and there is no advertising or third-party analytics on this site.
      </P>

      <H2>Where it comes from</H2>
      <UL>
        <LI>Publicly available business listings and public business pages</LI>
        <LI>Manual entry or file import by the operator</LI>
        <LI>A business&rsquo;s own reply to an email</LI>
      </UL>

      <H2>Why it is used</H2>
      <P>
        To contact businesses about a commercial offer, to make that contact relevant rather than
        generic, to keep track of who replied so nobody is contacted repeatedly, and to honour
        opt-out requests permanently. Information is used for no other purpose. It is never sold,
        rented, or shared for anyone else&rsquo;s marketing.
      </P>
      <P>
        The lawful basis relied on is legitimate interest under Section 12(f) of the Data Privacy
        Act of 2012 (Republic Act No. 10173): introducing a relevant commercial offer to businesses
        at their published contact points, in a way any business can refuse once and not hear from
        again. When a business writes back by email, that reply is stored and answered on the
        same basis.
      </P>

      <H2>Who else processes it</H2>
      <P>
        The tool is self-hosted and information is not disclosed to third parties, other than to
        the service providers that make it run:
      </P>
      <UL>
        <LI><strong>MongoDB Atlas</strong> — database hosting</LI>
        <LI><strong>Vercel</strong> — application hosting</LI>
        <LI><strong>Google (Gmail API)</strong> — sending and receiving email from the operator&rsquo;s own mailbox</LI>
        <LI><strong>Anthropic</strong> — drafting message text. The business details listed above are sent to this service to compose a draft; the operator reviews drafts before anything is sent</LI>
      </UL>
      <P>
        Information may be stored on servers outside the Philippines, since these providers operate
        internationally. The operator remains responsible for it wherever it is stored.
      </P>

      <H2>How long it is kept</H2>
      <P>
        Contact records are kept while outreach to that business is ongoing or a conversation is
        live, and are deleted on request. Message logs live exactly as long as the contact record
        they belong to: they are the record of what was sent and when, which is what lets an
        opt-out be honoured and any later question about a message be answered. Delete the contact
        record and its message logs go with it.
      </P>
      <P>
        <strong>One exception, and it exists to protect you.</strong> If you opt out or ask to be
        deleted, your email address is kept on a suppression list indefinitely. That list is the
        mechanism that prevents you from ever being contacted again — deleting the entry would
        allow a future import to add you back. It is used for nothing else, and holds only the
        address, a reason, and a date.
      </P>

      <H2>Your rights</H2>
      <P>Under the Data Privacy Act of 2012 you may:</P>
      <UL>
        <LI>Be informed about, and ask for a copy of, what is held about you</LI>
        <LI>Have inaccurate information corrected</LI>
        <LI>Object to the processing, and be removed from further contact</LI>
        <LI>Ask for erasure or blocking of your information</LI>
        <LI>Claim damages for a proven violation, and ask for a machine-readable copy of anything you yourself supplied</LI>
        <LI>Lodge a complaint with the National Privacy Commission (privacy.gov.ph)</LI>
      </UL>
      <P>
        To exercise any of these, email <strong>{CONTACT_EMAIL}</strong>. Requests are answered
        within 30 days. See the <a href="/data-deletion" style={{ color: "#BC5228" }}>data deletion</a>{" "}
        page for exactly what happens when you ask to be removed.
      </P>

      <H2>Opting out</H2>
      <P>
        Every email sent carries a one-line opt-out note. Replying to the email itself is the
        fastest route: any reply, whatever its wording, halts the automated sequence before the
        next send, and an opt-out is recorded permanently. You can also message the Facebook Page,
        or email the address above. A request made there is applied as soon as it is read, and
        just as permanently.
      </P>

      <H2>Security</H2>
      <P>
        The dashboard is password-protected and reachable only by the operator. Traffic is
        encrypted in transit. Access credentials for the connected email, database and messaging
        accounts are stored as encrypted environment variables and are never exposed publicly.
        Attempts to log in are recorded with the IP address they came from, to limit password
        guessing; this tool deletes its record of them after fifteen minutes.
      </P>

      <H2>Children</H2>
      <P>
        This tool is directed at businesses. It is not intended for children and does not knowingly
        collect information about them.
      </P>

      <H2>Changes</H2>
      <P>
        If this policy changes materially, the date at the top of this page is updated. The current
        version is always the one published here.
      </P>

      <H2>Contact</H2>
      <P>
        Questions, requests, or complaints: <strong>{CONTACT_EMAIL}</strong>. The operator of this
        tool and the party responsible for the information it holds is {OPERATOR_NAME}.
      </P>
    </LegalLayout>
  );
}

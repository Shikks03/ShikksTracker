import type { Metadata } from "next";
import LegalLayout, { H2, P, UL, LI } from "@/components/LegalLayout";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Data Deletion — ShikksTracker",
  description: "How to ask ShikksTracker to delete information held about your business.",
};

export default function DataDeletionPage() {
  return (
    <LegalLayout
      title="Data Deletion"
      intro="How to have information about your business removed, what gets deleted, and what is deliberately kept."
    >
      <H2>How to request deletion</H2>
      <P>
        Email <strong>{CONTACT_EMAIL}</strong> with the subject line{" "}
        <strong>&ldquo;Delete my data&rdquo;</strong>, and include:
      </P>
      <UL>
        <LI>Your business name</LI>
        <LI>The email address, phone number, or Facebook Page name that was contacted</LI>
      </UL>
      <P>
        That is the whole process. There is no form and no account to sign into. You can also
        simply reply to any email you received, or message the Facebook Page, and ask to be
        removed — that is treated as the same request.
      </P>

      <H2>What happens</H2>
      <UL>
        <LI>The request is acknowledged, and completed within 30 days</LI>
        <LI>Your contact record is deleted, including business name, email address, phone number, social handles, website, and any notes held about your business</LI>
        <LI>Any unsent drafts addressed to you are deleted</LI>
        <LI>Records of messages already sent, and of any reply you sent, are deleted</LI>
        <LI>Any Facebook Page conversation with you, and its messages, are deleted</LI>
        <LI>No further contact is made, on any channel</LI>
      </UL>

      <H2>The one thing that is kept, and why</H2>
      <P>
        Your email address is kept on an internal <strong>suppression list</strong>, together with
        a reason and a date. Nothing else is retained.
      </P>
      <P>
        This is not an exception made for convenience — it is what makes the deletion stick. The
        suppression list is checked before any import and before any message is sent, and it is the
        only mechanism that prevents your business from being added back the next time a public
        listing is imported. Deleting the entry would remove that protection and could result in
        you being contacted again.
      </P>
      <P>
        The list is never used to contact anyone, is never shared, and holds no other information
        about you. If you would prefer it removed anyway, say so in your request and it will be
        deleted — but understand that a future import may then re-add your business, and you would
        need to opt out again.
      </P>

      <H2>Facebook Page conversations</H2>
      <P>
        If you messaged the Facebook Page, the stored copy of that conversation is deleted as
        described above. Deleting it here does not remove the conversation from Facebook&rsquo;s own
        systems or from your Messenger inbox — to remove your data from Meta, use the privacy
        controls in your Facebook account.
      </P>

      <H2>Questions</H2>
      <P>
        Email <strong>{CONTACT_EMAIL}</strong>. See also the{" "}
        <a href="/privacy" style={{ color: "#BC5228" }}>privacy policy</a> for what is held and why,
        including your rights under the Philippine Data Privacy Act of 2012.
      </P>
    </LegalLayout>
  );
}

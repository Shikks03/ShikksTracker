# Legitimate Interest Assessment — ShikksTracker

**System:** ShikksTracker, a private, self-hosted, single-operator outreach tool
**Personal information controller and assessor:** Shikkari Ipil, an individual based in the Philippines. I am the sole operator; nobody else can log in. Because this is a one-person operation, the person conducting this assessment and the person accountable for the processing are the same. I am not pretending otherwise; the compensating control is that every consequential action in the system already requires my hands on it, and this document is the record the NPC may inspect.
**Legal basis assessed:** Section 12(f), Data Privacy Act of 2012 (RA 10173), per NPC Circular No. 2023-07 (Guidelines on Legitimate Interest)
**Date of assessment:** 4 September 2026 · **Version:** 1.0
**Contact and rights mailbox:** riku.mnl26@gmail.com
**Privacy notice:** https://shikkstracker.vercel.app/privacy (drafted and published in the course of this assessment; states the Section 12(f) basis). Erasure instructions: /data-deletion on the same site.

**Timing of this assessment.** Personal information was first collected into this system in late July 2026; this assessment was completed on 4 September 2026, after that initial collection and before any outreach. As of this date the automated engine has never generated or sent a message (both engine switches have been off since installation), and no message has ever been delivered to a data subject: the only sends were tests to my own addresses, and a single "mark sent" test entry against a real contact record was reversed, with nothing delivered. Every message a data subject will ever receive will therefore be sent under this assessment, and Sections 1, 5 and 7 state what must be in place before the first one.

**Scope note.** Legitimate interest under Section 12(f) is available only for ordinary personal information, never for sensitive or privileged personal information. No sensitive personal information is collected by design and no field is directed at such data: no government identifiers, no payment details, no precise location. The one uncontrolled input, the text of a public review, passes through my personal review before any use in a draft; a systematic screen at import is among the open items in Section 7. Data subjects are business contacts: owners, staff, or contact persons of Philippine small businesses. A record concerning a purely juridical entity falls outside the DPA, but records cannot be reliably classified at import — many Philippine small businesses are one person — so I treat every record as personal information.

## 1. Purpose test (Circular 2023-07 §5)

**The interest.** Direct business-to-business marketing: introducing my commercial offer to Philippine small businesses at contact points those businesses have published for business purposes, and handling the conversations that follow — replies, follow-ups, and the sales pipeline that results.

NPC Circular 2023-04 §14(A) expressly recognizes direct marketing as a legitimate interest under Section 12(f) where the processing is limited to personal information, on the condition that the controller conducts an assessment. This document is that assessment, completed before any outreach. Where a contact's data was instead obtained on the strength of consent (the system accepts referral and event-connection leads), a withdrawal of that consent is absolute, and no legitimate-interest fallback will be claimed for continued marketing to that contact (§14(C)).

**It is specific, not vague or overbroad.** The processing is one activity: at most three short outreach messages to a business's published contact point, then either a conversation or silence. There is no secondary use — no resale, no enrichment for third parties, no advertising audience building.

**It is lawful.** Unsolicited B2B contact at published business contact points is an ordinary commercial practice the DPA does not prohibit; what the law demands is a valid basis, transparency, proportionality, and respect for objection, each addressed below. Opt-outs are honoured before the next send, and once read, permanently (Section 4).

**Declaration to data subjects — the gate.** The Circular requires the established interest to be declared prior to the processing or at the next practical opportunity. For contacts sourced from public listings, prior notice is impossible: I hold nothing but their published listing until the first message, so the first message is the next practical opportunity. This assessment therefore authorizes first-touch outreach only in a configuration where the message itself carries the declaration. For email, that is a footer combining the opt-out line with a link to the privacy notice, appended untracked at send time after the link-tracking pass; for hand-sent phone and social messages, an equivalent line in the message template. Until that configuration exists on a channel, first-touch outreach on that channel is outside this assessment. The privacy notice is the published record of the declared interest; the footer and template lines are the mechanism by which it reaches each data subject. Contacts who message my Facebook Page first have initiated the exchange themselves and are answered, not marketed to unannounced.

## 2. Necessity test (§6)

Each data element maps to a function; nothing is held "in case it's useful":

| Data | Why it is necessary |
|---|---|
| Business name, category, general locality; published email, phone, website, Facebook and Instagram handles | The only practicable means of identifying and reaching a business I have no prior relationship with. Scraped listings mostly lack email, so the phone and social vectors are not redundant; they are usually the only vector. |
| Contact person's name, only where the business publishes one | Ordinary courtesy in addressing; never collected from any non-published source. |
| Public listing signals: star rating, review count, one recent public review's text and age | Lets each message reference the business's own public details, which is what keeps messages individually drafted rather than bulk-blasted. |
| Message logs: subject, full text, dates | The audit trail of what was actually said to whom; necessary for accountability and for honouring rights requests accurately. |
| Open and click events, reply text, engagement score | Tells me whether to stop (any reply halts the sequence) and whom to personally attend to first. The system records that an email was opened or a link clicked, the time of the first such event, and a count of repeats; the score (+1 open, +3 click, +10 reply) moves only on the first open and first click. |
| Meta page-scoped sender ID, display name, message text, timestamps | The minimum Meta provides to hold a conversation someone started with my Page. |

**The means are proportionate.** Messages are short (about 120 words), individually drafted, sent under a hard cap of 15 emails a day, only 8am–6pm Manila time, in a three-touch maximum sequence at days 0, 5 and 9; then contact stops permanently. Email is the only automated channel, and every AI-drafted email passes my personal review gate before sending. Facebook, Instagram, and phone messages are AI-drafted but sent by hand, by me, one at a time. Every outreach email is built to carry the opt-out and declaration footer (Section 1). No cookies are set on data subjects and no third-party analytics run on them.

## 3. Collection method and NPC Advisory No. 2026-01 (data scraping)

Contacts enter this system three ways: browser-extension capture of business listing data that Google Maps renders publicly to a signed-out visitor, manual entry, and inbound messages. The first is data scraping within the meaning of NPC Advisory No. 2026-01 (13 April 2026), and I assess it against that Advisory rather than around it.

- No authentication is bypassed and no technical anti-scraping measure (CAPTCHA, robots exclusion, rate defence) is circumvented or deceived; the extension captures what any signed-out person sees in a browser.
- The scale sits outside every factor the Advisory lists for large-scale scraping: a few dozen data subjects to date, listing-level fields only, intermittent manual sessions rather than sustained automated crawling.
- Collection is restricted to the business-directory fields the business itself published to attract contact. No field captures a reviewer's identity; the free text of a review could still contain identifying or sensitive fragments, which is why it passes through my personal review before use, and why the import-stage screen is an open item (Section 7).
- Platform terms of service restricting automated access are a contractual matter between me and the platform; the data subjects whose rights Section 12(f) balances are not parties to those terms and are not injured by the manner of access. The risk that the NPC reads Advisory 2026-01 §4 more broadly is assessed as low at this scale, mitigated by non-circumvention and minimal volume, and is a standing review item (Section 8).
- The Advisory's retention rule is adopted: scraped records that produce no engagement are deleted a set period after their sequence ends. The period is fixed at go-live and recorded in a revision of this document (Section 7).
- The privacy impact assessment the Advisory requires for scraping (§3(F)) does not yet exist. Conducting it and annexing it here is an open item in Section 7, ahead of first outreach.

## 4. Balancing test (§7)

**(a) Effect and impact on the data subject.** The realistic worst case for any individual is receiving up to three short, relevant business messages at an address their business chose to publish, over nine days, then never again. No automated decision adverse to any person is made from the data this system holds; the only automated consequences run in the data subject's favour (a reply halts all further sending), and the only human decision the data informs is the order of my own attention.

**(b) Safeguards in place.** Every email carries the opt-out and declaration footer. Any reply whatsoever halts the automated sequence before the next send: reply detection runs before the send step in every engine cycle. Opt-outs are recorded permanently on a suppression list checked at import and again before every send (see Section 7, item 1, for the current key limitation and its committed fix). Rights requests to riku.mnl26@gmail.com get a response within 30 days; deletion on request covers the contact record, drafts, message logs, mailbox copies, and the Messenger conversation, with the suppression entry retained solely so the opt-out sticks. Technically: password plus HMAC session authentication on everything non-public, encrypted transit, credentials in encrypted environment variables, login rate limiting.

**(c) Alternative means.** Consent is structurally unavailable for a first contact with a stranger — there is no prior channel through which to ask — and no other Section 12 basis fits. The real choice is between more and less intrusive versions of the same interest, and I have chosen the least intrusive workable one: published business contact points only, minimal data, hard caps, human gates, and a permanent stop on any objection, applied before the next send.

**(d) Reasonable expectation, assessed per operation.** A business that publishes an email address, phone number, or social page on a public listing does so to be contacted there about business. A short, individually written commercial introduction at that exact contact point sits within what a reasonable business owner finds acceptable, and a contact person's name is used only where the business itself published it. The operations a data subject cannot see are a different matter, and each is either disclosed in the first message itself (the Section 1 gate) or in the notice it links to: AI-assisted drafting, the named processors, offshore storage, and the tracking weighed below. Nothing undisclosed is done to any data subject. People who message my Facebook Page have the strongest expectation of all: they wrote first and are owed a reply.

**(e) The tracking question, weighed separately.** Tracking cannot borrow the outreach's justification, so I weigh it on its own. What is collected: that an email was opened or a link clicked, the time of the first such event, and a count of repeats; the score moves only on first events. This is the closest question in this assessment under the least-intrusive-means standard — the NPC has held a controller liable despite a conceded legitimate interest where the means chosen was not the least intrusive available (MAF v. Shopee, NPC 21-167) — and I do not pretend otherwise. Two design facts weigh on my side: the disclosure path is itself untracked (the privacy-notice link is appended after the link-tracking pass, so reading the disclosure is never logged), and no tracking event has any consequence for the person beyond the order of my attention. Whether open-tracking ships at go-live at all is an open item in Section 7, resolved before the first send.

**Conclusion on balance.** A modest, capped, human-gated commercial approach at published business contact points, declared in the first message, with an always-available and permanently honoured exit, does not override the fundamental rights and freedoms of these data subjects. The interest prevails, subject to the gates and open items this document itself imposes.

## 5. Profiling, registration, and NPC Circular 2022-04

Two distinct obligations, kept separate.

**Registration of the data processing system (Circular 2022-04 §5).** The trigger is that a system involves automated decision-making or profiling at all. I concede plainly that the engagement scoring is automated end-to-end: opens, clicks, and replies move the score with no human act on the scoring event, and for the many Philippine small businesses that are one person, scoring "the business's" engagement is scoring that person's behaviour. On the Circular's text that is profiling, whatever its modest consequences here. Whether to register the system on the NPC registration system is the open decision recorded in Section 7, resolved before go-live; this section records why the sworn declaration of exemption is hard to sign while automated scoring runs. (In a one-person operation the Individual Professional acts as the de facto data protection officer, §5(C).)

**Notification regarding automated decision-making.** A separate duty attaches where automated processing is the sole basis for decisions that significantly affect a data subject. That trigger is not met: every consequential act — a send, a follow-up, a pipeline move — passes through me personally; the score affects nothing but the sort order of my own dashboard; and the only automated state changes run in the data subject's favour, since a reply halts sending.

**Tripwire commitment.** If I ever key any automation off the engagement score (auto-prioritized sending, automatic dropping of contacts, automatic cadence changes), the second analysis flips too: automated processing would begin making decisions with real effect. I commit to updating this assessment and completing every then-applicable registration and notification duty before any such feature ships, not after.

## 6. Processors and cross-border accountability (DPA §21)

| Processor | Role | Personal data it receives |
|---|---|---|
| MongoDB Atlas | database hosting | all stored records |
| Vercel | application hosting | all data passing through the app |
| Google (Gmail API) | sending and receiving email from my own mailbox | email addresses, message content |
| Meta | delivering and receiving Facebook Page messages | sender IDs, display names, message content |
| Anthropic | drafting message text | business details as described in Section 2; I review every draft |

Each relationship runs on the provider's commercial terms incorporating data-processing and security commitments; Section 21's "contractual or other reasonable means" are satisfied by those executed or incorporated terms, and I remain the accountable controller wherever the data sits. Anthropic receives business details solely to compose drafts, and its commercial API terms bar training on submitted content; confirming the account sits on those commercial terms is a verification item in Section 7. Data may be stored outside the Philippines. The DPA's accountability model, not a transfer-restriction model, governs, and accountability stays with me.

## 7. Known gaps, open decisions, and committed fixes

Stated as facts, because this is an internal record, not a brochure.

Committed fixes, gated ahead of first real outreach or Meta App Review submission, whichever comes first:

1. The suppression list is currently keyed on email only. The code change to also key on the business's stable listing ID, so phone- and social-only contacts suppress just as permanently, lands before that gate.
2. The declaration footer (Section 1), with its phone and DM template counterpart, ships on the same schedule; the privacy notice itself is live now.
3. Messenger-conversation deletion is currently manual, not an automated cascade; a written runbook for the full deletion sequence, including the Gmail mailbox copies the public deletion page promises, is item 9 below. Requests are honoured within the 30-day commitment either way.

Open decisions, resolved before go-live and recorded in a revision of this document:

4. Whether to register the data processing system with the NPC (Section 5 records why the exempt declaration is hard to sign while automated scoring runs).
5. The privacy impact assessment covering scraping required by Advisory 2026-01 §3(F), conducted and annexed.
6. Whether open-tracking ships at go-live: dropped, or kept with an in-body disclosure line and first-event-capped counts (Section 4(e)).
7. An import-stage screen that rejects or redacts review text carrying sensitive personal information before storage (Scope note).
8. The retention period for scraped records that produce no engagement (Section 3).
9. The written deletion runbook (item 3).
10. Verifications before this document is signed: the production site serves the three public pages, and the Anthropic account is on commercial API terms (Section 6).

## 8. Review triggers

I revisit this assessment, before the change ships where feasible, upon any of: new categories of personal data, especially anything approaching sensitive personal information; a new outreach channel; any automation keyed off the engagement score (Section 5 tripwire); material change in volume or scale — the leap from dozens of contacts to thousands is a material change requiring re-assessment and a refresh of the scraping PIA; any sale or sharing of the data, which is currently never done and not planned; a change of processors; new NPC guidance or enforcement on legitimate interest, registration, or data scraping. Independent of triggers, I re-evaluate at least annually, per the Circular's duty to regularly evaluate compliance.

## 9. Record, and what this assessment changed

This document records the conduct and result of the assessment NPC Circular 2023-07 requires, kept with its dated revisions for production to the NPC on request. The Circular's own transitory provision (§15) acknowledged that controllers may document assessments for processing already underway; this one was completed after initial collection and before any outreach (see the timing note in the header).

The assessment was not an after-the-fact description of a finished system; it changed the system. In its course: the three public legal pages were drafted, hardened and published; the public opt-out promise was reworded from "immediately" to the mechanical guarantee the engine actually provides (any reply halts the sequence before the next send); the declaration footer was designed to append untracked, after the assessment identified that the link-tracking pass would otherwise log access to the privacy disclosure itself; the operator's published identity was corrected to the bare legal name pending business-name registration; first-touch outreach was made conditional on the Section 1 declaration gate; and the open decisions in Section 7 were put ahead of go-live rather than behind it.

**Assessed and adopted by:** Shikkari Ipil — controller, operator, and assessor (same person; see header) — 4 September 2026.

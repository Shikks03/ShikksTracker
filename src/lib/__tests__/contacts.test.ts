/**
 * Unit tests for src/lib/contacts.ts covering two bugfixes found in an
 * external code review of the multi-channel outreach work:
 *
 *  - Bug 1: suppressContact must NOT write to the Suppression collection for
 *    an email-less (facebook/instagram/phone) contact — the contact status
 *    transition and pending-log deletion must still happen.
 *  - Bug 3: createContactChecked's non-email-channel dedupe lookup must match
 *    an existing businessName case-insensitively and trimmed, agreeing with
 *    the import route's intra-file dedupe key, and must escape regex
 *    metacharacters in the business name rather than interpolating it raw.
 *
 * No DB integration harness exists in this project — models are vi.mock-ed,
 * matching the style already used for advanceContactAfterSend in
 * sequence.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Model + db mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/models/Contact", () => ({
  default: {
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/models/EmailLog", () => ({
  default: {
    deleteMany: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock("@/models/Suppression", () => ({
  default: {
    updateOne: vi.fn(),
    findOne: vi.fn(),
  },
}));

import { suppressContact, createContactChecked } from "@/lib/contacts";
import Contact from "@/models/Contact";
import EmailLog from "@/models/EmailLog";
import Suppression from "@/models/Suppression";

const mockLean = (value: unknown) => ({ lean: vi.fn().mockResolvedValue(value) });

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Bug 1: suppressContact with an email-less contact
// ---------------------------------------------------------------------------

describe("suppressContact", () => {
  it("does NOT write to Suppression for an email-less (facebook) contact, but still updates status and deletes pending logs", async () => {
    const contactId = "contact-fb-1";
    (Contact.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: contactId, businessName: "Cafe X", contactEmail: undefined, outreachChannel: "facebook" })
    );
    (Contact.findByIdAndUpdate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (EmailLog.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await suppressContact(contactId, "unsubscribed");

    expect(Suppression.updateOne).not.toHaveBeenCalled();
    expect(Contact.findByIdAndUpdate).toHaveBeenCalledWith(contactId, {
      status: "unsubscribed",
      nextSendAt: null,
    });
    expect(EmailLog.deleteMany).toHaveBeenCalledWith({
      contactId,
      status: { $in: ["draft", "approved"] },
    });
  });

  it("still skips Suppression when contactEmail is an empty string", async () => {
    const contactId = "contact-fb-2";
    (Contact.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: contactId, businessName: "Cafe Y", contactEmail: "", outreachChannel: "phone" })
    );
    (Contact.findByIdAndUpdate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (EmailLog.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await suppressContact(contactId, "bounced");

    expect(Suppression.updateOne).not.toHaveBeenCalled();
    expect(Contact.findByIdAndUpdate).toHaveBeenCalledWith(contactId, {
      status: "bounced",
      nextSendAt: null,
    });
  });

  it("upserts Suppression as before for a normal email contact (behaviour unchanged)", async () => {
    const contactId = "contact-email-1";
    (Contact.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: contactId, businessName: "Cafe Z", contactEmail: "owner@cafez.ph", outreachChannel: "email" })
    );
    (Suppression.updateOne as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (Contact.findByIdAndUpdate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (EmailLog.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await suppressContact(contactId, "unsubscribed");

    expect(Suppression.updateOne).toHaveBeenCalledWith(
      { email: "owner@cafez.ph" },
      {
        $setOnInsert: { email: "owner@cafez.ph", addedAt: expect.any(Date) },
        $set: { reason: "unsubscribed" },
      },
      { upsert: true }
    );
    expect(Contact.findByIdAndUpdate).toHaveBeenCalledWith(contactId, {
      status: "unsubscribed",
      nextSendAt: null,
    });
  });

  it("skips the Suppression upsert when upsertSuppression: false is passed, even for an email contact", async () => {
    const contactId = "contact-email-2";
    (Contact.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: contactId, businessName: "Cafe W", contactEmail: "owner@cafew.ph", outreachChannel: "email" })
    );
    (Contact.findByIdAndUpdate as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (EmailLog.deleteMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await suppressContact(contactId, "unsubscribed", { upsertSuppression: false });

    expect(Suppression.updateOne).not.toHaveBeenCalled();
  });

  it("returns silently (no writes) when the contact is not found", async () => {
    (Contact.findById as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockLean(null));

    await suppressContact("missing-id", "unsubscribed");

    expect(Suppression.updateOne).not.toHaveBeenCalled();
    expect(Contact.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(EmailLog.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Bug 3: createContactChecked non-email-channel dedupe — case-insensitive,
// trimmed, regex-escaped businessName match.
// ---------------------------------------------------------------------------

describe("createContactChecked — non-email channel businessName dedupe", () => {
  it("matches an existing contact regardless of case (agrees with the import route's toLowerCase() intra-file key)", async () => {
    (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: "existing-1", businessName: "Sunrise Cafe" })
    );

    const result = await createContactChecked(
      {
        businessName: "SUNRISE CAFE",
        keyPoints: "kp",
        campaignId: "campaign-1",
        outreachChannel: "facebook",
        facebook: "https://facebook.com/sunrisecafe",
      },
      "csv"
    );

    expect(result.outcome).toBe("duplicate");
    expect(Contact.findOne).toHaveBeenCalledTimes(1);
    const queryArg = (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryArg.campaignId).toBe("campaign-1");
    expect(queryArg.businessName.$options).toBe("i");
    // Anchored so "Sunrise Cafeteria" does not falsely match "Sunrise Cafe"
    expect(queryArg.businessName.$regex.startsWith("^")).toBe(true);
    expect(queryArg.businessName.$regex.endsWith("$")).toBe(true);
  });

  it("escapes regex metacharacters in the business name so they match literally", async () => {
    (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockLean(null));
    (Contact.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: "new-1",
      businessName: "Mang Inasal (Session Rd.)",
    });

    const result = await createContactChecked(
      {
        businessName: "Mang Inasal (Session Rd.)",
        keyPoints: "kp",
        campaignId: "campaign-1",
        outreachChannel: "phone",
        phone: "09171234567",
      },
      "csv"
    );

    expect(result.outcome).toBe("inserted");
    const queryArg = (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const regexSource: string = queryArg.businessName.$regex;
    // Parentheses and the period must be escaped, not left as active regex syntax.
    expect(regexSource).toContain("\\(Session Rd\\.\\)");
    // Sanity: the escaped pattern actually matches the literal string case-insensitively.
    const re = new RegExp(regexSource, "i");
    expect(re.test("Mang Inasal (Session Rd.)")).toBe(true);
    expect(re.test("Mang InasalXSession RdYZ")).toBe(false);
  });

  it("trims surrounding whitespace before matching", async () => {
    (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: "existing-2", businessName: "Bakeshop" })
    );

    await createContactChecked(
      {
        businessName: "  Bakeshop  ",
        keyPoints: "kp",
        campaignId: "campaign-1",
        outreachChannel: "instagram",
        instagram: "@bakeshop",
      },
      "csv"
    );

    const queryArg = (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(queryArg.businessName.$regex).toBe("^Bakeshop$");
  });

  it("still dedupes on sourcePlaceId (exact match) when provided, bypassing the businessName regex", async () => {
    (Contact.findOne as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      mockLean({ _id: "existing-3", sourcePlaceId: "place-123" })
    );

    const result = await createContactChecked(
      {
        businessName: "Some Business",
        keyPoints: "kp",
        campaignId: "campaign-1",
        outreachChannel: "facebook",
        facebook: "https://facebook.com/somebusiness",
        sourcePlaceId: "place-123",
      },
      "csv"
    );

    expect(result.outcome).toBe("duplicate");
    expect(Contact.findOne).toHaveBeenCalledWith({
      sourcePlaceId: "place-123",
      campaignId: "campaign-1",
    });
  });
});

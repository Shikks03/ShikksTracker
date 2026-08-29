import { describe, it, expect, vi, beforeEach } from "vitest";

const findOne = vi.fn();
const findByIdAndUpdate = vi.fn();
const deleteMany = vi.fn();
const contactUpdate = vi.fn();
const bump = vi.fn();

vi.mock("@/models/EmailLog", () => ({
  default: {
    findOne: (...a: unknown[]) => findOne(...a),
    findByIdAndUpdate: (...a: unknown[]) => findByIdAndUpdate(...a),
    deleteMany: (...a: unknown[]) => deleteMany(...a),
  },
}));
vi.mock("@/models/Contact", () => ({
  default: { findByIdAndUpdate: (...a: unknown[]) => contactUpdate(...a) },
}));
vi.mock("@/lib/scoring", () => ({
  SCORE_REPLY: 10,
  bumpEngagement: (...a: unknown[]) => bump(...a),
}));

import { applyReplyEffects } from "@/lib/replyEffects";

const CONTACT = "507f1f77bcf86cd799439011";
const LOG = { _id: "log1", replied: false };

function chain(result: unknown) {
  return { sort: () => ({ lean: () => Promise.resolve(result) }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  deleteMany.mockResolvedValue({ deletedCount: 0 });
  findByIdAndUpdate.mockResolvedValue(null);
  contactUpdate.mockResolvedValue(null);
  bump.mockResolvedValue(null);
});

describe("applyReplyEffects", () => {
  it("applies every effect for a fresh reply", async () => {
    findOne.mockReturnValue(chain(LOG));
    const at = new Date("2026-08-30T02:00:00Z");

    const res = await applyReplyEffects({
      contactId: CONTACT, channel: "facebook", replyText: "Interested po!", repliedAt: at,
    });

    expect(res).toEqual({ applied: true, logId: "log1" });
    expect(contactUpdate).toHaveBeenCalledWith(CONTACT, {
      status: "replied", pipelineStage: "replied", nextSendAt: null,
    });
    expect(findByIdAndUpdate).toHaveBeenCalledWith("log1", expect.objectContaining({
      replied: true, repliedAt: at, replySnippet: "Interested po!",
    }));
    expect(bump).toHaveBeenCalledWith(CONTACT, 10);
    expect(deleteMany).toHaveBeenCalledWith({
      contactId: CONTACT, status: { $in: ["draft", "approved"] },
    });
  });

  it("is idempotent: an already-replied anchor bumps nothing", async () => {
    findOne.mockReturnValue(chain({ _id: "log1", replied: true }));
    const res = await applyReplyEffects({
      contactId: CONTACT, channel: "facebook", replyText: "again", repliedAt: new Date(),
    });
    expect(res.applied).toBe(false);
    expect(bump).not.toHaveBeenCalled();
    expect(findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("still marks the contact replied when there is no sent log to anchor to", async () => {
    findOne.mockReturnValue(chain(null));
    const res = await applyReplyEffects({
      contactId: CONTACT, channel: "facebook", replyText: "hi", repliedAt: new Date(),
    });
    // No anchor to stamp, but a human DID reply — the contact must leave the
    // cold sequence regardless, or it keeps getting follow-ups.
    expect(res).toEqual({ applied: true, logId: null });
    expect(contactUpdate).toHaveBeenCalled();
    expect(bump).toHaveBeenCalledWith(CONTACT, 10);
  });

  it("scopes the anchor lookup to the channel", async () => {
    findOne.mockReturnValue(chain(LOG));
    await applyReplyEffects({
      contactId: CONTACT, channel: "facebook", replyText: "x", repliedAt: new Date(),
    });
    expect(findOne).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: CONTACT, status: "sent", channel: "facebook" })
    );
  });

  it("truncates an enormous reply body before it reaches the schema", async () => {
    findOne.mockReturnValue(chain(LOG));
    await applyReplyEffects({
      contactId: CONTACT, channel: "facebook", replyText: "x".repeat(200_000), repliedAt: new Date(),
    });
    const update = findByIdAndUpdate.mock.calls[0][1] as { replyBody: string };
    expect(update.replyBody.length).toBeLessThanOrEqual(99_001);
  });
});

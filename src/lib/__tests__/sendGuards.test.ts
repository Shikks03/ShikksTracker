/**
 * Unit tests for src/lib/sendGuards.ts.
 *
 * This rule is the one deliberate behaviour change in RikuOS P1 (spec §D.2 ⚠️),
 * so it is pinned tightly: the permit must open for response-shaped logs and
 * for nothing else.
 */

import { describe, it, expect } from "vitest";
import { isSendableContactStatus } from "@/lib/sendGuards";

const SEQUENCE_LOG = {};
const RIKUOS_LOG = { origin: "rikuos" };
const THREADED_LOG = { replyToLogId: "68b0f0f0f0f0f0f0f0f0f0f0" };

describe("isSendableContactStatus", () => {
  it("allows an active contact for an ordinary sequence log", () => {
    expect(isSendableContactStatus("active", SEQUENCE_LOG)).toBe(true);
  });

  it("blocks a replied contact for an ordinary sequence log", () => {
    // Pre-2026-08-28 behaviour for every log, and still correct here: a replied
    // contact must not keep receiving scheduled cold touches.
    expect(isSendableContactStatus("replied", SEQUENCE_LOG)).toBe(false);
  });

  it("allows a replied contact for a RikuOS-originated log", () => {
    expect(isSendableContactStatus("replied", RIKUOS_LOG)).toBe(true);
  });

  it("allows a replied contact for a log threaded onto a prior message", () => {
    expect(isSendableContactStatus("replied", THREADED_LOG)).toBe(true);
  });

  it.each(["paused", "bounced", "unsubscribed"])(
    "never allows a %s contact, even for a response-shaped log",
    (status) => {
      expect(isSendableContactStatus(status, RIKUOS_LOG)).toBe(false);
      expect(isSendableContactStatus(status, THREADED_LOG)).toBe(false);
    }
  );

  it("fails closed on a missing or unrecognised status", () => {
    expect(isSendableContactStatus(undefined, RIKUOS_LOG)).toBe(false);
    expect(isSendableContactStatus(null, RIKUOS_LOG)).toBe(false);
    expect(isSendableContactStatus("weird", RIKUOS_LOG)).toBe(false);
  });

  it("treats an explicitly null replyToLogId as absent", () => {
    expect(isSendableContactStatus("replied", { replyToLogId: null })).toBe(false);
  });

  it("treats an unrecognised origin as an ordinary log", () => {
    expect(isSendableContactStatus("replied", { origin: "app" })).toBe(false);
    expect(isSendableContactStatus("replied", { origin: "somewhere-else" })).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { isEchoMatch, ECHO_MATCH_THRESHOLD } from "@/lib/messenger/echo";

describe("isEchoMatch", () => {
  const draft = "Hi Cafe Luna! Napansin ko po yung bagong branch niyo sa Katipunan. Gumagawa po ako ng websites para sa small businesses.";

  it("matches an exact paste", () => {
    expect(isEchoMatch(draft, draft)).toBe(true);
  });

  it("matches a paste with light edits", () => {
    const edited = "Hi Cafe Luna! Napansin ko po yung bagong branch niyo sa Katipunan. Gumagawa ako ng websites para sa small businesses.";
    expect(isEchoMatch(edited, draft)).toBe(true);
  });

  it("does not match an unrelated message", () => {
    expect(isEchoMatch("Salamat po, open kami until 9pm.", draft)).toBe(false);
  });

  it("does not match a short generic acknowledgement", () => {
    // The dangerous false positive: a two-word reply that happens to share
    // tokens must never advance the pipeline.
    expect(isEchoMatch("Salamat po!", draft)).toBe(false);
  });

  it("requires a substantial message on both sides", () => {
    expect(isEchoMatch("ok", "ok")).toBe(false);
  });

  it("has a threshold high enough to be a paste, not a paraphrase", () => {
    expect(ECHO_MATCH_THRESHOLD).toBeGreaterThanOrEqual(0.8);
  });
});

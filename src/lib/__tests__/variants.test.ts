/**
 * Unit tests for src/lib/variants.ts.
 *
 * Only the pure selector is tested — pickVariantForDraft() is a thin two-query
 * wrapper around it, and this project has no DB integration harness (same
 * split as generateDrafts vs. the pure helpers in sequence.ts).
 */

import { describe, it, expect } from "vitest";
import { selectLeastUsedVariant, type SelectableVariant } from "@/lib/variants";

function V(key: string, active = true): SelectableVariant {
  return {
    key,
    active,
    channel: "email",
    stage: 1,
    label: key,
    promptNotes: `notes for ${key}`,
  };
}

describe("selectLeastUsedVariant", () => {
  it("returns null when there are no variants at all", () => {
    expect(selectLeastUsedVariant([], {})).toBeNull();
  });

  it("returns null when every variant is inactive", () => {
    expect(selectLeastUsedVariant([V("a", false), V("b", false)], {})).toBeNull();
  });

  it("excludes inactive variants even when they are the least used", () => {
    const picked = selectLeastUsedVariant([V("idle", false), V("busy")], { busy: 12 });
    expect(picked?.key).toBe("busy");
  });

  it("picks the variant with the fewest logs in this campaign", () => {
    const picked = selectLeastUsedVariant([V("a"), V("b"), V("c")], { a: 5, b: 1, c: 9 });
    expect(picked?.key).toBe("b");
  });

  it("treats a variant absent from the usage map as zero uses", () => {
    const picked = selectLeastUsedVariant([V("used"), V("fresh")], { used: 3 });
    expect(picked?.key).toBe("fresh");
  });

  it("breaks ties by key, so selection does not depend on input order", () => {
    const usage = { zebra: 2, alpha: 2 };
    expect(selectLeastUsedVariant([V("zebra"), V("alpha")], usage)?.key).toBe("alpha");
    expect(selectLeastUsedVariant([V("alpha"), V("zebra")], usage)?.key).toBe("alpha");
  });

  it("does not mutate the array it is given", () => {
    const variants = [V("zebra"), V("alpha")];
    selectLeastUsedVariant(variants, {});
    expect(variants.map((v) => v.key)).toEqual(["zebra", "alpha"]);
  });

  it("returns the full variant so the caller can read promptNotes", () => {
    const picked = selectLeastUsedVariant([V("only")], {});
    expect(picked?.promptNotes).toBe("notes for only");
  });
});

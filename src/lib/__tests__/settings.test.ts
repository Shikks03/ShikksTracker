/**
 * Unit tests for src/lib/settings.ts. Mocks @/models/Settings (same convention
 * as the Contact/EmailLog/Campaign mocks in sequence.test.ts) since this repo
 * has no live-DB test infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/models/Settings", () => ({
  default: { findOneAndUpdate: vi.fn() },
}));

import Settings from "@/models/Settings";
import { getSettings, updateSettings } from "@/lib/settings";

const mockFindOneAndUpdate = Settings.findOneAndUpdate as unknown as Mock;

beforeEach(() => {
  mockFindOneAndUpdate.mockReset();
});

describe("getSettings", () => {
  it("returns the existing singleton unchanged via an empty $set", async () => {
    const existing = { draftGenerationEnabled: true, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(existing);

    const result = await getSettings();

    expect(result).toBe(existing);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: {} },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("upserts (creates with schema defaults) when no document exists yet", async () => {
    const created = { draftGenerationEnabled: false, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(created);

    const result = await getSettings();

    expect(result).toBe(created);
    const [, , options] = mockFindOneAndUpdate.mock.calls[0];
    expect(options).toMatchObject({ upsert: true, setDefaultsOnInsert: true });
  });
});

describe("updateSettings", () => {
  it("passes only the given field through to $set", async () => {
    const updated = { draftGenerationEnabled: true, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(updated);

    const result = await updateSettings({ draftGenerationEnabled: true });

    expect(result).toBe(updated);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: { draftGenerationEnabled: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("passes both fields through to $set when both are given", async () => {
    const updated = { draftGenerationEnabled: true, sendingEnabled: true };
    mockFindOneAndUpdate.mockResolvedValue(updated);

    await updateSettings({ draftGenerationEnabled: true, sendingEnabled: true });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: { draftGenerationEnabled: true, sendingEnabled: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });

  it("passes an empty $set when called with no fields", async () => {
    const unchanged = { draftGenerationEnabled: false, sendingEnabled: false };
    mockFindOneAndUpdate.mockResolvedValue(unchanged);

    await updateSettings({});

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      {},
      { $set: {} },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
  });
});

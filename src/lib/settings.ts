/**
 * settings.ts — access layer for the singleton engine-control Settings doc.
 *
 * Both getSettings() and updateSettings() go through the same atomic
 * findOneAndUpdate with upsert:true — getSettings() is just updateSettings({})
 * (an empty $set changes nothing on an existing doc, and upsert still creates
 * one with schema defaults if none exists). This avoids a separate
 * find-then-create path that could race with a concurrent first call.
 *
 * Callers (the /api/settings route, runSequenceEngine) are responsible for
 * calling connectDB() first — same convention as the per-run helpers in
 * src/lib/sequence.ts.
 */

import Settings from "@/models/Settings";
import type { ISettings } from "@/models/Settings";

export interface SettingsPatch {
  draftGenerationEnabled?: boolean;
  sendingEnabled?: boolean;
}

export async function updateSettings(patch: SettingsPatch): Promise<ISettings> {
  const updated = await Settings.findOneAndUpdate(
    {},
    { $set: patch },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return updated as ISettings;
}

export async function getSettings(): Promise<ISettings> {
  return updateSettings({});
}

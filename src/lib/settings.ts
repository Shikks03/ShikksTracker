/**
 * settings.ts — access layer for the singleton engine-control Settings doc.
 *
 * Both getSettings() and updateSettings() go through the same atomic
 * findOneAndUpdate with upsert:true — getSettings() is just updateSettings({})
 * (an empty $set leaves the two boolean fields unchanged, and upsert still
 * creates one with schema defaults if none exists).
 *
 * Known limitation, accepted for this single-user tool: the query filter is
 * `{}` with no unique index behind it, so a genuine two-caller race on the
 * very first-ever call (before any Settings doc exists) could in theory
 * still produce two documents. Not fixed here — would need a unique
 * singleton key or fixed _id, which is disproportionate for a tool with one
 * user and one narrow first-call window.
 *
 * Note: because the Settings schema has `timestamps: { updatedAt: true }`,
 * every call here — including a pure getSettings() read — advances
 * `updatedAt`, since Mongoose's timestamps plugin sets it on every
 * findOneAndUpdate. `updatedAt` therefore reflects "last time anything
 * touched this doc," not "last time a user changed a toggle."
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

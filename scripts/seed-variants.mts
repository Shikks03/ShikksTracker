/**
 * seed-variants.mts — creates the starting message-approach variants.
 *
 * Idempotent: upserts by `key`, so re-running never duplicates. It deliberately
 * does NOT reset `active` on an existing variant — if you deactivated one from
 * the database, re-running the seed must not silently switch it back on.
 *
 * USAGE
 *   npm run seed:variants
 */

import mongoose from "mongoose";
import Variant from "../src/models/Variant.ts";

const SEEDS = [
  {
    key: "email-s1-painpoint",
    channel: "email" as const,
    stage: 1 as const,
    label: "Email S1 — pain point first",
    promptNotes:
      "Open on the concrete problem this business is living with right now, inferred from the key points (customers who cannot find their hours, bookings lost to a competitor with a website, reviews they never reply to). Name the cost of that problem in one plain sentence before mentioning the offer at all. Do not compliment the business in the opening line. The offer should read as the obvious answer to the problem you just named, not as a pitch that arrives first.",
  },
  {
    key: "email-s1-compliment",
    channel: "email" as const,
    stage: 1 as const,
    label: "Email S1 — specific compliment first",
    promptNotes:
      "Open by referencing one specific, verifiable detail from the key points: a dish, a review someone actually left, how long they have been open, something they clearly did on purpose. It must be a detail no other business could receive. Earn the next sentence with that, then move to the offer as a small, natural suggestion. Never open with a generic compliment about their great reputation or amazing service.",
  },
  {
    key: "fb-s1-painpoint",
    channel: "facebook" as const,
    stage: 1 as const,
    label: "Facebook DM S1 — pain point first",
    promptNotes:
      "Open with the gap you noticed, phrased as a casual observation rather than a diagnosis (for example: noticing there is no link for booking anywhere on the page). One sentence, no lecture, no list of everything wrong. Then a single low-friction ask. Keep it shorter than the email version: this is a DM someone reads on a phone between orders.",
  },
  {
    key: "fb-s1-compliment",
    channel: "facebook" as const,
    stage: 1 as const,
    label: "Facebook DM S1 — specific compliment first",
    promptNotes:
      "Open by reacting to one specific thing from the key points the way a real person browsing the page would: a photo, a dish, a recent post. Sound like a human who actually looked, not a template with a slot filled in. Then one low-friction ask. Do not stack two compliments, and do not explain who you are before the compliment lands.",
  },
];

async function main(): Promise<number> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      "MONGODB_URI is not set.\n" +
        "This script reads it from .env.local via node --env-file. Check that\n" +
        ".env.local exists and defines MONGODB_URI."
    );
    return 1;
  }

  const redacted = uri.replace(/\/\/[^@]*@/, "//<credentials>@");
  console.log(`Connecting to: ${redacted}`);
  await mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 10_000 });
  console.log(`Database:      ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);

  for (const seed of SEEDS) {
    const res = await Variant.updateOne(
      { key: seed.key },
      {
        $set: {
          channel: seed.channel,
          stage: seed.stage,
          label: seed.label,
          promptNotes: seed.promptNotes,
        },
        // `active` is set only on insert — see the docblock.
        $setOnInsert: { active: true },
      },
      { upsert: true }
    );
    const verb = res.upsertedCount ? "created" : "updated";
    console.log(`   ${verb.padEnd(8)} ${seed.key}`);
  }

  const total = await Variant.countDocuments({});
  console.log(`\nDone. ${SEEDS.length} seed variant(s) applied; ${total} variant(s) in the collection.`);
  await mongoose.disconnect();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("\nSeed failed:", err instanceof Error ? err.message : err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });

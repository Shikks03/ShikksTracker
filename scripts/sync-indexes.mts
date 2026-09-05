/**
 * sync-indexes.mts — re-runnable index migration for the models listed in
 * MODELS below (Contact, EmailLog, Variant).
 *
 * WHY THIS EXISTS
 * ---------------
 * Mongoose only ever CREATES missing indexes on startup. It will not alter or
 * drop an index that already exists under the same name with different
 * options. The multi-channel work (2026-07-29) changed
 *
 *     { contactEmail: 1, campaignId: 1 }   plain unique
 *  -> { contactEmail: 1, campaignId: 1 }   PARTIAL unique ($type: "string")
 *
 * The index name is unchanged (`contactEmail_1_campaignId_1`), so from
 * MongoDB's point of view it already exists and nothing happens — the old,
 * wrong index silently stays.
 *
 * That matters because scraped contacts have NO email. Under a plain unique
 * compound index a missing field is indexed as null, so the FIRST email-less
 * contact stores { contactEmail: null, campaignId: X } fine and every
 * subsequent one collides with E11000. Symptom: importing a 200-row scraper
 * CSV lands exactly one contact and fails the other 199.
 *
 * A second index, { sourcePlaceId: 1, campaignId: 1 } (also partial unique),
 * is new and simply needs creating.
 *
 * USAGE
 * -----
 *   npm run migrate:indexes          # DRY RUN — shows the diff, changes nothing
 *   npm run migrate:indexes:apply    # actually applies it
 *
 * Dry run is the default deliberately: syncIndexes() drops ANY index on the
 * collection that is not declared in the schema. If someone added one by hand
 * in Atlas, it would go. Look at the diff before applying.
 *
 * Run it while nothing else is touching the database — there is a brief window
 * during the drop-and-recreate where uniqueness is not enforced.
 */

import mongoose from "mongoose";
import Contact from "../src/models/Contact.ts";
import EmailLog from "../src/models/EmailLog.ts";
import Variant from "../src/models/Variant.ts";
import type { Model } from "mongoose";

/**
 * Every model whose indexes this script manages. Adding a model here opts its
 * collection into the same dry-run diff / apply / verify cycle.
 *
 * WARNING: syncIndexes() drops ANY index on a listed collection that is not
 * declared in that model's schema. Only list models whose schema is the single
 * source of truth for their indexes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODELS: Array<{ label: string; model: Model<any> }> = [
  { label: "Contact", model: Contact },
  { label: "EmailLog", model: EmailLog },
  { label: "Variant", model: Variant },
];

const APPLY = process.argv.includes("--apply");

/** Indexes we expect to end up partial-unique, and the field each filters on. */
const EXPECTED_PARTIAL: Array<{ name: string; field: string }> = [
  { name: "contactEmail_1_campaignId_1", field: "contactEmail" },
  { name: "sourcePlaceId_1_campaignId_1", field: "sourcePlaceId" },
];

interface IndexInfo {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
}

function describe(ix: IndexInfo): string {
  const bits: string[] = [`keys=${JSON.stringify(ix.key ?? {})}`];
  if (ix.unique) bits.push("unique");
  if (ix.sparse) bits.push("SPARSE");
  if (ix.partialFilterExpression) {
    bits.push(`partial=${JSON.stringify(ix.partialFilterExpression)}`);
  }
  return `${(ix.name ?? "(unnamed)").padEnd(34)} ${bits.join(" · ")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listIndexes(model: Model<any>, label: string): Promise<IndexInfo[]> {
  const indexes = (await model.collection.indexes()) as IndexInfo[];
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 58 - label.length))}`);
  for (const ix of indexes) console.log("   " + describe(ix));
  return indexes;
}

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

  // Show which database we are about to touch — this is very likely the SAME
  // Atlas cluster as production, since this is a single-user self-hosted tool.
  const redacted = uri.replace(/\/\/[^@]*@/, "//<credentials>@");
  console.log(`Connecting to: ${redacted}`);
  console.log(`Mode:          ${APPLY ? "APPLY (will modify indexes)" : "DRY RUN (no changes)"}`);

  // Short server-selection timeout so a wrong/unreachable URI fails in seconds
  // rather than hanging on the driver's 30 s default.
  await mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 10_000 });
  console.log(`Database:      ${mongoose.connection.db?.databaseName ?? "(unknown)"}`);

  // --- Phase 1: show the diff for every managed model ---
  let anyChange = false;
  const plans: Array<{ label: string; toDrop: string[]; toCreate: Record<string, unknown>[] }> = [];

  for (const { label, model } of MODELS) {
    await listIndexes(model, `${label} — BEFORE`);

    // diffIndexes reports what syncIndexes WOULD do, without doing it.
    const diff = (await model.diffIndexes()) as {
      toDrop: string[];
      toCreate: Record<string, unknown>[];
    };
    plans.push({ label, ...diff });
    if (diff.toDrop.length || diff.toCreate.length) anyChange = true;
  }

  console.log(`\n── PLANNED CHANGES ${"─".repeat(43)}`);
  if (!anyChange) {
    console.log("   Nothing to do — the live indexes already match the schemas.");
  } else {
    for (const plan of plans) {
      if (!plan.toDrop.length && !plan.toCreate.length) continue;
      console.log(`   [${plan.label}]`);
      for (const name of plan.toDrop) console.log(`     DROP    ${name}`);
      for (const spec of plan.toCreate) console.log(`     CREATE  ${JSON.stringify(spec)}`);
    }
  }

  if (!APPLY) {
    console.log(
      "\nDry run only — nothing was changed.\n" +
        "Re-run with `npm run migrate:indexes:apply` to apply the changes above.\n" +
        "Note: syncIndexes() drops ANY index not declared in the schema, so if a\n" +
        "DROP above is something you added by hand in Atlas, stop and reconsider."
    );
    await mongoose.disconnect();
    return 0;
  }

  if (!anyChange) {
    await mongoose.disconnect();
    return 0;
  }

  // --- Phase 2: apply ---
  console.log("\nApplying…");
  for (const { label, model } of MODELS) {
    const dropped = await model.syncIndexes();
    console.log(`   [${label}] syncIndexes() dropped: ${JSON.stringify(dropped)}`);
  }

  const contactAfter = await listIndexes(Contact, "Contact — AFTER");
  for (const { label, model } of MODELS) {
    if (label === "Contact") continue;
    await listIndexes(model, `${label} — AFTER`);
  }

  // Verify the two Contact indexes that motivated this migration really are
  // partial. A plain-unique survivor here is the exact failure mode this script
  // exists to fix, so fail loudly rather than reporting success.
  console.log(`\n── VERIFICATION ${"─".repeat(46)}`);
  let ok = true;
  for (const { name, field } of EXPECTED_PARTIAL) {
    const ix = contactAfter.find((i) => i.name === name);
    if (!ix) {
      console.error(`   MISSING  ${name} — expected it to exist after sync`);
      ok = false;
      continue;
    }
    const filter = ix.partialFilterExpression?.[field] as { $type?: string } | undefined;
    if (filter?.$type !== "string") {
      console.error(
        `   WRONG    ${name} has no partialFilterExpression on ${field} ` +
          `(got ${JSON.stringify(ix.partialFilterExpression ?? null)})`
      );
      ok = false;
      continue;
    }
    if (ix.sparse) {
      // A compound sparse index still indexes docs that have ANY of the keys,
      // and campaignId is always present — which is what broke before.
      console.error(`   WRONG    ${name} is still sparse; it must be partial instead`);
      ok = false;
      continue;
    }
    console.log(`   OK       ${name} is partial-unique on ${field}`);
  }

  await mongoose.disconnect();

  if (!ok) {
    console.error("\nMigration did NOT reach the expected state. Do not import scraper CSVs yet.");
    return 1;
  }
  console.log("\nDone. Indexes match the schemas for: " + MODELS.map((m) => m.label).join(", ") + ".");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("\nMigration failed:", err instanceof Error ? err.message : err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });

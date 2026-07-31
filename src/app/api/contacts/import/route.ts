import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { parseContactsCsv } from "@/lib/csv";
import {
  parseScraperCsv,
  buildScraperKeyPoints,
  deriveChannel,
  parseRecentReviewDays,
} from "@/lib/scraperCsv";
import { createContactChecked, normalizeEmail } from "@/lib/contacts";
import { handleError } from "@/lib/api";
import { asObjectIdString } from "@/lib/validate";
import { envInt } from "@/lib/env";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

type ImportFormat = "standard" | "scraper";
type DefaultChannel = "facebook" | "instagram" | "phone";

const VALID_FORMATS: readonly ImportFormat[] = ["standard", "scraper"];
const VALID_DEFAULT_CHANNELS: readonly DefaultChannel[] = ["facebook", "instagram", "phone"];

// security-phase-2 (Wave C): each row costs 2-3 sequential awaited DB
// queries inside createContactChecked, with no batching — an oversized CSV
// (either in raw bytes or in row count after parsing) is an easy
// self-inflicted outage with no upstream limit today. Both caps are
// env-tunable; defaults are generous for a legitimate single-user CSV
// export (Maps Lead Scraper batches are in the low thousands of rows).
const MAX_IMPORT_BYTES = envInt("MAX_IMPORT_BYTES", 2_000_000);
const MAX_IMPORT_ROWS = envInt("MAX_IMPORT_ROWS", 5000);

function importTooLarge(bytes: number): NextResponse {
  return NextResponse.json(
    { error: `CSV exceeds the maximum import size of ${MAX_IMPORT_BYTES} bytes (got ${bytes})` },
    { status: 413 }
  );
}

function importTooManyRows(count: number): NextResponse {
  return NextResponse.json(
    { error: `CSV exceeds the maximum of ${MAX_IMPORT_ROWS} rows (got ${count})` },
    { status: 413 }
  );
}

interface SuppressedEntry {
  row: number;
  email?: string;
  businessName?: string;
  reason: string;
}

interface DuplicateEntry {
  row: number;
  email?: string;
  businessName?: string;
}

interface InvalidEntry {
  row: number;
  reason: string;
}

/**
 * POST /api/contacts/import
 *
 * Accepts either:
 *   - multipart/form-data  with fields `file` (CSV), `campaignId`,
 *                           `format` ("standard" | "scraper", default "standard"),
 *                           `defaultChannel` ("facebook" | "instagram" | "phone", optional)
 *   - application/json     with body { csvText, campaignId, format?, defaultChannel? }
 *
 * `format: "scraper"` accepts the 29-column "Maps Lead Scraper" Chrome-extension
 * export (no email/contact-name columns) and creates contacts on a non-email
 * outreach channel (facebook/instagram/phone), personalised via a deterministic
 * `keyPoints` string built from the scraped business data. See src/lib/scraperCsv.ts.
 *
 * Returns a 200 summary:
 * {
 *   "inserted": <number>,
 *   "skipped": {
 *     "suppressed": [{ row, email?, businessName?, reason }],
 *     "duplicates": [{ row, email?, businessName? }],
 *     "invalid":    [{ row, reason }]
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  const authError = await requireSession(request);
  if (authError) return authError;
  try {
    await connectDB();

    let csvText: string;
    let campaignId: string;
    let format: ImportFormat = "standard";
    let defaultChannel: DefaultChannel | undefined;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      // JSON path — useful for testing without a real file upload
      const body = (await request.json()) as {
        csvText?: string;
        campaignId?: string;
        format?: string;
        defaultChannel?: string;
      };
      // typeof checks, not truthiness: an unvalidated `campaignId` of e.g.
      // `{"$ne": null}` passes a bare `!body.campaignId` check (it is a
      // truthy object) and would otherwise flow into Campaign.findById below,
      // turning it into `findOne({_id:{$ne:null}})` — an arbitrary-campaign
      // existence-gate bypass. asObjectIdString only ever returns a plain
      // valid-ObjectId string, never the original value.
      if (typeof body.csvText !== "string" || body.csvText.length === 0) {
        return NextResponse.json({ error: "csvText is required" }, { status: 400 });
      }
      if (body.csvText.length > MAX_IMPORT_BYTES) {
        return importTooLarge(body.csvText.length);
      }
      const validCampaignId = asObjectIdString(body.campaignId);
      if (validCampaignId === null) {
        return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
      }
      if (body.format !== undefined) {
        if (!VALID_FORMATS.includes(body.format as ImportFormat)) {
          return NextResponse.json(
            { error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
            { status: 400 }
          );
        }
        format = body.format as ImportFormat;
      }
      if (body.defaultChannel !== undefined) {
        if (!VALID_DEFAULT_CHANNELS.includes(body.defaultChannel as DefaultChannel)) {
          return NextResponse.json(
            { error: `defaultChannel must be one of: ${VALID_DEFAULT_CHANNELS.join(", ")}` },
            { status: 400 }
          );
        }
        defaultChannel = body.defaultChannel as DefaultChannel;
      }
      csvText = body.csvText;
      campaignId = validCampaignId;
    } else {
      // multipart/form-data path
      const formData = await request.formData();
      const fileField = formData.get("file");
      const campaignIdField = formData.get("campaignId");
      const formatField = formData.get("format");
      const defaultChannelField = formData.get("defaultChannel");

      if (!fileField || typeof fileField === "string") {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      // Check size BEFORE reading the body into memory via .text() below —
      // the whole point of the cap is to avoid buffering an oversized file.
      if ((fileField as File).size > MAX_IMPORT_BYTES) {
        return importTooLarge((fileField as File).size);
      }
      if (!campaignIdField || typeof campaignIdField !== "string") {
        return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
      }
      if (formatField !== null) {
        if (typeof formatField !== "string" || !VALID_FORMATS.includes(formatField as ImportFormat)) {
          return NextResponse.json(
            { error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
            { status: 400 }
          );
        }
        format = formatField as ImportFormat;
      }
      if (defaultChannelField !== null) {
        if (
          typeof defaultChannelField !== "string" ||
          !VALID_DEFAULT_CHANNELS.includes(defaultChannelField as DefaultChannel)
        ) {
          return NextResponse.json(
            { error: `defaultChannel must be one of: ${VALID_DEFAULT_CHANNELS.join(", ")}` },
            { status: 400 }
          );
        }
        defaultChannel = defaultChannelField as DefaultChannel;
      }

      csvText = await (fileField as File).text();
      campaignId = campaignIdField;
    }

    // Validate campaignId is a well-formed ObjectId before it reaches a
    // query — the JSON branch already guaranteed this above, but the
    // multipart branch only checked `typeof === "string"`, so re-validate
    // here to cover both paths uniformly.
    const validatedCampaignId = asObjectIdString(campaignId);
    if (validatedCampaignId === null) {
      return NextResponse.json({ error: "Invalid campaignId" }, { status: 400 });
    }

    // Validate campaignId exists
    const campaign = await Campaign.findById(validatedCampaignId).lean();
    if (!campaign) {
      return NextResponse.json({ error: `Not found: ${campaignId}` }, { status: 404 });
    }

    if (format === "scraper") {
      return await handleScraperImport(csvText, validatedCampaignId, defaultChannel);
    }
    return await handleStandardImport(csvText, validatedCampaignId);
  } catch (err) {
    return handleError(err);
  }
}

async function handleStandardImport(csvText: string, campaignId: string) {
  // Parse the CSV into valid rows and parse-level errors
  const { rows, errors: parseErrors } = parseContactsCsv(csvText);

  if (rows.length > MAX_IMPORT_ROWS) {
    return importTooManyRows(rows.length);
  }

  let insertedCount = 0;
  const suppressed: SuppressedEntry[] = [];
  const duplicates: DuplicateEntry[] = [];
  // Seed invalid list with parse-level errors (missing required fields, bad leadSource)
  const invalid: InvalidEntry[] = parseErrors.map((e) => ({
    row: e.row,
    reason: e.reason,
  }));

  // Track normalised emails seen within this import to catch intra-CSV dupes.
  // A later occurrence of the same address in the same file counts as a duplicate.
  const seenEmails = new Set<string>();

  for (const row of rows) {
    const normalized = normalizeEmail(row.contactEmail);

    // Intra-CSV duplicate check
    if (seenEmails.has(normalized)) {
      duplicates.push({ row: row.rowNumber, email: normalized });
      continue;
    }
    seenEmails.add(normalized);

    // Delegate to shared creation logic (validates email, checks suppression,
    // checks DB duplicate, then inserts)
    const result = await createContactChecked(
      {
        businessName: row.businessName,
        contactEmail: row.contactEmail,
        contactName: row.contactName,
        keyPoints: row.keyPoints,
        leadSource: row.leadSource,
        campaignId,
      },
      "csv"
    );

    switch (result.outcome) {
      case "inserted":
        insertedCount++;
        break;
      case "suppressed":
        suppressed.push({ row: row.rowNumber, email: normalized, reason: result.reason });
        break;
      case "duplicate":
        duplicates.push({ row: row.rowNumber, email: normalized });
        break;
      case "invalid":
        invalid.push({ row: row.rowNumber, reason: result.reason });
        break;
    }
  }

  return NextResponse.json({
    inserted: insertedCount,
    skipped: {
      suppressed,
      duplicates,
      invalid,
    },
  });
}

async function handleScraperImport(
  csvText: string,
  campaignId: string,
  defaultChannel: DefaultChannel | undefined
) {
  const { rows, errors: parseErrors } = parseScraperCsv(csvText);

  if (rows.length > MAX_IMPORT_ROWS) {
    return importTooManyRows(rows.length);
  }

  let insertedCount = 0;
  const suppressed: SuppressedEntry[] = [];
  const duplicates: DuplicateEntry[] = [];
  const invalid: InvalidEntry[] = parseErrors.map((e) => ({
    row: e.row,
    reason: e.reason,
  }));

  // Intra-file dedupe: keyed on placeId when present, else lowercased businessName.
  const seenKeys = new Set<string>();

  for (const row of rows) {
    const dedupeKey = row.placeId ? row.placeId : row.businessName.trim().toLowerCase();

    if (seenKeys.has(dedupeKey)) {
      duplicates.push({ row: row.rowNumber, businessName: row.businessName });
      continue;
    }
    seenKeys.add(dedupeKey);

    const channel = deriveChannel(row, defaultChannel);
    if (!channel) {
      invalid.push({
        row: row.rowNumber,
        reason: "no contact vector (facebook/instagram/phone)",
      });
      continue;
    }

    const keyPoints = buildScraperKeyPoints(row);

    const result = await createContactChecked(
      {
        businessName: row.businessName,
        keyPoints,
        leadSource: "other",
        campaignId,
        outreachChannel: channel,
        phone: row.phone,
        facebook: row.facebook,
        instagram: row.instagram,
        website: row.website,
        sourcePlaceId: row.placeId,
        webPresenceTier: row.webPresenceTier,
        claimed: row.claimed,
        recentReviewDays: parseRecentReviewDays(row.recentReviewDays),
      },
      "csv"
    );

    switch (result.outcome) {
      case "inserted":
        insertedCount++;
        break;
      case "suppressed":
        suppressed.push({
          row: row.rowNumber,
          businessName: row.businessName,
          reason: result.reason,
        });
        break;
      case "duplicate":
        duplicates.push({ row: row.rowNumber, businessName: row.businessName });
        break;
      case "invalid":
        invalid.push({ row: row.rowNumber, reason: result.reason });
        break;
    }
  }

  return NextResponse.json({
    inserted: insertedCount,
    skipped: {
      suppressed,
      duplicates,
      invalid,
    },
  });
}

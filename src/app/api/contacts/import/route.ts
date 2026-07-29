import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { parseContactsCsv } from "@/lib/csv";
import { parseScraperCsv, buildScraperKeyPoints, deriveChannel } from "@/lib/scraperCsv";
import { createContactChecked, normalizeEmail } from "@/lib/contacts";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

type ImportFormat = "standard" | "scraper";
type DefaultChannel = "facebook" | "instagram" | "phone";

const VALID_FORMATS: readonly ImportFormat[] = ["standard", "scraper"];
const VALID_DEFAULT_CHANNELS: readonly DefaultChannel[] = ["facebook", "instagram", "phone"];

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
      if (!body.csvText) {
        return NextResponse.json({ error: "csvText is required" }, { status: 400 });
      }
      if (!body.campaignId) {
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
      campaignId = body.campaignId;
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

    // Validate campaignId exists
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return NextResponse.json({ error: `Not found: ${campaignId}` }, { status: 404 });
    }

    if (format === "scraper") {
      return await handleScraperImport(csvText, campaignId, defaultChannel);
    }
    return await handleStandardImport(csvText, campaignId);
  } catch (err) {
    return handleError(err);
  }
}

async function handleStandardImport(csvText: string, campaignId: string) {
  // Parse the CSV into valid rows and parse-level errors
  const { rows, errors: parseErrors } = parseContactsCsv(csvText);

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

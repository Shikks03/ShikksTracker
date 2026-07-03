import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import Campaign from "@/models/Campaign";
import { parseContactsCsv } from "@/lib/csv";
import { createContactChecked, normalizeEmail } from "@/lib/contacts";
import { handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

interface SuppressedEntry {
  row: number;
  email: string;
  reason: string;
}

interface DuplicateEntry {
  row: number;
  email: string;
}

interface InvalidEntry {
  row: number;
  reason: string;
}

/**
 * POST /api/contacts/import
 *
 * Accepts either:
 *   - multipart/form-data  with fields `file` (CSV) and `campaignId`
 *   - application/json     with body { csvText: string, campaignId: string }
 *
 * Returns a 200 summary:
 * {
 *   "inserted": <number>,
 *   "skipped": {
 *     "suppressed": [{ row, email, reason }],
 *     "duplicates": [{ row, email }],
 *     "invalid":    [{ row, reason }]
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    let csvText: string;
    let campaignId: string;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      // JSON path — useful for testing without a real file upload
      const body = (await request.json()) as {
        csvText?: string;
        campaignId?: string;
      };
      if (!body.csvText) {
        return NextResponse.json({ error: "csvText is required" }, { status: 400 });
      }
      if (!body.campaignId) {
        return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
      }
      csvText = body.csvText;
      campaignId = body.campaignId;
    } else {
      // multipart/form-data path
      const formData = await request.formData();
      const fileField = formData.get("file");
      const campaignIdField = formData.get("campaignId");

      if (!fileField || typeof fileField === "string") {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      if (!campaignIdField || typeof campaignIdField !== "string") {
        return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
      }

      csvText = await (fileField as File).text();
      campaignId = campaignIdField;
    }

    // Validate campaignId exists
    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign) {
      return NextResponse.json({ error: `Not found: ${campaignId}` }, { status: 404 });
    }

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
  } catch (err) {
    return handleError(err);
  }
}

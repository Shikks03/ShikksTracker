"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Panel, Button, inputClass } from "@/components/ui";
import {
  serif, grotesk, mono, INK, FAINT, FAINT2, CLAY,
  FOREST_ACTION as FOREST,
} from "@/components/tokens";
import { apiFetch } from "@/lib/client";
import { toastError, toastSuccess } from "@/lib/toast";
import { previewCsv, CsvPreviewResult } from "@/lib/previewCsv";
import { parseScraperCsv, deriveChannel, NonEmailChannel } from "@/lib/scraperCsv";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  _id: string;
  name: string;
}

const LEAD_SOURCES = [
  { value: "cold_email",       label: "Cold Email" },
  { value: "referral",         label: "Referral" },
  { value: "event_connection", label: "Event Connection" },
  { value: "other",            label: "Other" },
] as const;

interface ImportApiResult {
  inserted: number;
  skipped: {
    suppressed: Array<{ row: number; email: string; reason: string }>;
    duplicates: Array<{ row: number; email: string }>;
    invalid:    Array<{ row: number; reason: string }>;
  };
}

interface LastImport {
  fileName:   string;
  totalRows:  number;
  inserted:   number;
  suppressed: number;
  duplicates: number;
  invalid:    number;
  at:         string;
}

const LS_KEY = "lastImport";

const LEAD_SOURCE_LABELS: Record<string, string> = {
  cold_email:       "Cold Email",
  referral:         "Referral",
  event_connection: "Event Connection",
  other:            "Other",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [tab,        setTab]        = useState<"csv" | "scraper" | "manual">("csv");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastImport,  setLastImport]  = useState<LastImport | null>(null);

  // Preview state (CSV tab)
  const [pendingFile,   setPendingFile]   = useState<File | null>(null);
  const [preview,       setPreview]       = useState<CsvPreviewResult | null>(null);
  const [showAllInvalid, setShowAllInvalid] = useState(false);

  // Preview state (Maps Scraper tab) — kept separate from the CSV tab's state so
  // switching tabs never leaks one tab's selected file into the other.
  const [scraperPendingFile, setScraperPendingFile] = useState<File | null>(null);
  const [scraperParsed, setScraperParsed] = useState<ReturnType<typeof parseScraperCsv> | null>(null);
  const [defaultChannel, setDefaultChannel] = useState<NonEmailChannel>("facebook");

  // Manual form
  const [businessName,   setBusinessName]   = useState("");
  const [contactEmail,   setContactEmail]   = useState("");
  const [contactName,    setContactName]    = useState("");
  const [keyPoints,      setKeyPoints]      = useState("");
  const [leadSource,     setLeadSource]     = useState("cold_email");
  const [manualLoading,  setManualLoading]  = useState(false);
  const [manualSuccess,  setManualSuccess]  = useState(false);
  const [manualError,    setManualError]    = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const scraperFileRef = useRef<HTMLInputElement>(null);

  // Load campaigns (previously swallowed errors with `.catch(() => {})` — GAPS 4.2)
  useEffect(() => {
    apiFetch<Campaign[]>("/api/campaigns").then(({ data, error }) => {
      if (Array.isArray(data)) {
        setCampaigns(data);
        if (data.length > 0) setCampaignId(data[0]._id);
      } else if (error) {
        setUploadError(`Couldn't load campaigns — ${error}`);
      }
    });
  }, []);

  // Hydrate lastImport from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setLastImport(JSON.parse(stored) as LastImport);
    } catch { /* ignore */ }
  }, []);

  async function uploadFile(
    file: File,
    opts?: { format?: "scraper"; defaultChannel?: NonEmailChannel }
  ) {
    if (!campaignId) {
      setUploadError("No campaign selected");
      return;
    }
    const isScraper = opts?.format === "scraper";
    const activeRef = isScraper ? scraperFileRef : fileRef;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("campaignId", campaignId);
      if (opts?.format) formData.append("format", opts.format);
      if (opts?.defaultChannel) formData.append("defaultChannel", opts.defaultChannel);
      // Raw fetch (multipart), so it bypasses apiFetch's automatic toast.
      const res = await fetch("/api/contacts/import", { method: "POST", body: formData });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = body.error ?? `HTTP ${res.status}`;
        setUploadError(msg);
        toastError(`${msg} — nothing was imported.`, "IMPORT FAILED");
        return;
      }
      const data = (await res.json()) as ImportApiResult;
      const li: LastImport = {
        fileName:   file.name,
        totalRows:
          data.inserted +
          data.skipped.suppressed.length +
          data.skipped.duplicates.length +
          data.skipped.invalid.length,
        inserted:   data.inserted,
        suppressed: data.skipped.suppressed.length,
        duplicates: data.skipped.duplicates.length,
        invalid:    data.skipped.invalid.length,
        at:         new Date().toISOString(),
      };
      localStorage.setItem(LS_KEY, JSON.stringify(li));
      setLastImport(li);
      // Clear preview after successful upload — whichever tab initiated it
      if (isScraper) {
        setScraperPendingFile(null);
        setScraperParsed(null);
      } else {
        setPendingFile(null);
        setPreview(null);
      }
      toastSuccess(
        `${li.inserted} contact${li.inserted === 1 ? "" : "s"} imported from ${file.name}${
          li.totalRows - li.inserted > 0 ? ` · ${li.totalRows - li.inserted} skipped` : ""
        }.`,
        "IMPORTED"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUploadError(msg);
      toastError(`${msg} — nothing was imported.`, "IMPORT FAILED");
    } finally {
      setUploading(false);
      if (activeRef.current) activeRef.current.value = "";
    }
  }

  /** Parse a file client-side and show the preview panel (does not upload). */
  async function handleFileSelected(file: File) {
    setUploadError(null);
    setShowAllInvalid(false);
    try {
      const text = await file.text();
      const result = previewCsv(text);
      setPendingFile(file);
      setPreview(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave() { setIsDragOver(false); }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleCancelPreview() {
    setPendingFile(null);
    setPreview(null);
    setUploadError(null);
    setShowAllInvalid(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Parse a scraper CSV client-side and show the preview panel (does not upload). */
  async function handleScraperFileSelected(file: File) {
    setUploadError(null);
    try {
      const text = await file.text();
      const result = parseScraperCsv(text);
      setScraperPendingFile(file);
      setScraperParsed(result);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleScraperFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleScraperFileSelected(file);
  }

  function handleScraperDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleScraperFileSelected(file);
  }

  function handleScraperCancelPreview() {
    setScraperPendingFile(null);
    setScraperParsed(null);
    setUploadError(null);
    if (scraperFileRef.current) scraperFileRef.current.value = "";
  }

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) { setManualError("No campaign selected"); return; }
    setManualLoading(true);
    setManualError(null);
    setManualSuccess(false);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          contactEmail,
          contactName: contactName || undefined,
          keyPoints,
          leadSource,
          campaignId,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        const msg = data.error ?? `HTTP ${res.status}`;
        setManualError(msg);
        toastError(msg, "CONTACT NOT ADDED");
      } else {
        setManualSuccess(true);
        toastSuccess(`${businessName} added.`, "CONTACT ADDED");
        setBusinessName(""); setContactEmail(""); setContactName("");
        setKeyPoints(""); setLeadSource("cold_email");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setManualError(msg);
      toastError(msg, "CONTACT NOT ADDED");
    } finally {
      setManualLoading(false);
    }
  }

  // Derived preview for the Maps Scraper tab. Recomputed on every defaultChannel
  // change (not frozen at parse time) so switching the select updates the counts.
  const scraperPreview = useMemo(() => {
    if (!scraperParsed) return null;
    const ready: Array<{ businessName: string; channel: NonEmailChannel; handle: string }> = [];
    for (const row of scraperParsed.rows) {
      const channel = deriveChannel(row, defaultChannel);
      if (channel) {
        const handle = channel === "facebook" ? row.facebook : channel === "instagram" ? row.instagram : row.phone;
        ready.push({ businessName: row.businessName, channel, handle });
      }
    }
    const skipped = scraperParsed.errors.length + (scraperParsed.rows.length - ready.length);
    return { ready, skipped };
  }, [scraperParsed, defaultChannel]);

  const monoLabel: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: FAINT2,
    display: "block",
    marginBottom: 7,
  };

  const STAT_TILES = [
    { key: "inserted"   as const, label: "INSERTED",   bg: "#EAF2E7", border: "#C6D8C0", color: "#1C6E3A" },
    // Label only — the key still matches the API's `skipped.suppressed`.
    { key: "suppressed" as const, label: "BLOCKED",     bg: "#F7E8E2", border: "#E0C4B8", color: "#A23B28" },
    { key: "duplicates" as const, label: "DUPLICATES",  bg: "#F7EFD9", border: "#E2D3A8", color: "#96712A" },
    { key: "invalid"    as const, label: "INVALID",     bg: "#EFEBE0", border: "#D8CFBB", color: "#7A7263" },
  ] as const;

  // Max sample rows to show in the preview table
  const SAMPLE_MAX = 5;
  // Max invalid rows to show before "show all" toggle
  const INVALID_SHOW_MAX = 5;

  return (
    <div className="page-enter" style={{ maxWidth: 560, margin: "0 auto", padding: "44px 42px 80px" }}>

      {/* H1 */}
      <h1
        style={{
          fontFamily: serif,
          fontSize: 40,
          fontWeight: 400,
          color: INK,
          letterSpacing: "-0.01em",
          textAlign: "center",
          margin: 0,
          lineHeight: 1.1,
        }}
      >
        Import Contacts
      </h1>
      <div
        style={{
          fontFamily: mono,
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: FAINT,
          textAlign: "center",
          marginTop: 14,
        }}
      >
        BLOCKED EMAILS ARE ALWAYS SKIPPED
      </div>

      {/* Campaign select */}
      <div style={{ marginTop: 24 }}>
        <label style={monoLabel}>CAMPAIGN</label>
        <select
          className={inputClass}
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          {campaigns.length === 0 && <option value="">Loading campaigns…</option>}
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Segmented toggle */}
      <div
        style={{
          display: "flex",
          backgroundColor: "#E4DDC9",
          borderRadius: 8,
          padding: 4,
          marginTop: 18,
        }}
      >
        {(["csv", "scraper", "manual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              fontFamily: grotesk,
              fontWeight: 600,
              fontSize: 13.5,
              padding: "12px",
              borderRadius: 6,
              border: tab === t ? "1px solid #D3C9B4" : "1px solid transparent",
              backgroundColor: tab === t ? "#FCFAF3" : "transparent",
              color: tab === t ? INK : "#8E836C",
              cursor: "pointer",
              transition: "all 0.1s",
            }}
          >
            {t === "csv" ? "Upload CSV" : t === "scraper" ? "Maps Scraper" : "Add manually"}
          </button>
        ))}
      </div>

      {/* CSV tab */}
      {tab === "csv" && (
        <div style={{ marginTop: 18 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {/* ── Preview panel (shown after file is selected) ── */}
          {preview && pendingFile ? (
            <div>
              {/* Preview header */}
              <Panel style={{ padding: "18px 20px 16px" }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: FAINT,
                      }}
                    >
                      Preview
                    </span>
                    <div
                      style={{
                        fontFamily: grotesk,
                        fontWeight: 600,
                        fontSize: 15,
                        color: INK,
                        marginTop: 4,
                      }}
                    >
                      {pendingFile.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelPreview}
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: FAINT2,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px 6px",
                      flexShrink: 0,
                    }}
                  >
                    Cancel
                  </button>
                </div>

                {/* Stat bar */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 14,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: preview.validRows.length > 0 ? "#EAF2E7" : "#F5EFDF",
                      border: `1px solid ${preview.validRows.length > 0 ? "#C6D8C0" : "#CBBF9F"}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: serif,
                        fontSize: 28,
                        fontWeight: 400,
                        color: preview.validRows.length > 0 ? "#1C6E3A" : "#7A7263",
                        lineHeight: 1,
                      }}
                    >
                      {preview.validRows.length}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: preview.validRows.length > 0 ? "#1C6E3A" : "#7A7263",
                        marginTop: 6,
                      }}
                    >
                      Ready to import
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: preview.invalidRows.length > 0 ? "#F7E8E2" : "#F5EFDF",
                      border: `1px solid ${preview.invalidRows.length > 0 ? "#E0C4B8" : "#CBBF9F"}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: serif,
                        fontSize: 28,
                        fontWeight: 400,
                        color: preview.invalidRows.length > 0 ? "#A23B28" : "#7A7263",
                        lineHeight: 1,
                      }}
                    >
                      {preview.invalidRows.length}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: preview.invalidRows.length > 0 ? "#A23B28" : "#7A7263",
                        marginTop: 6,
                      }}
                    >
                      Invalid (will skip)
                    </div>
                  </div>
                </div>

                {/* Scope note */}
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: FAINT2,
                    letterSpacing: "0.05em",
                    marginTop: 12,
                    lineHeight: 1.6,
                  }}
                >
                  Suppressed and duplicate rows are detected on import — not shown here.
                </div>
              </Panel>

              {/* Valid rows sample table */}
              {preview.validRows.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: FAINT2,
                      marginBottom: 8,
                    }}
                  >
                    {preview.validRows.length > SAMPLE_MAX
                      ? `Sample — first ${SAMPLE_MAX} of ${preview.validRows.length} valid rows`
                      : `Valid rows`}
                  </div>
                  <div
                    style={{
                      border: "1px solid #D3C9B4",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    {/* Table header */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "3fr 4fr 2fr",
                        backgroundColor: "#F0EBE0",
                        borderBottom: "1px solid #D3C9B4",
                        padding: "6px 12px",
                      }}
                    >
                      {["Business", "Email", "Lead Source"].map((h) => (
                        <span
                          key={h}
                          style={{
                            fontFamily: mono,
                            fontSize: 9.5,
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            color: FAINT2,
                          }}
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                    {/* Table rows */}
                    {preview.validRows.slice(0, SAMPLE_MAX).map((row, idx) => (
                      <div
                        key={row.rowNumber}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "3fr 4fr 2fr",
                          padding: "8px 12px",
                          borderBottom: idx < Math.min(preview.validRows.length, SAMPLE_MAX) - 1
                            ? "1px solid #EAE3D5"
                            : "none",
                          backgroundColor: idx % 2 === 0 ? "#FCFAF3" : "#F8F5EC",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontSize: 13,
                            color: INK,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.businessName}
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 11.5,
                            color: "#5A5344",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.contactEmail}
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: FAINT2,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Invalid rows list */}
              {preview.invalidRows.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "#A23B28",
                      marginBottom: 8,
                    }}
                  >
                    Invalid rows — will be skipped
                  </div>
                  <div
                    style={{
                      border: "1px solid #E0C4B8",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    {(showAllInvalid
                      ? preview.invalidRows
                      : preview.invalidRows.slice(0, INVALID_SHOW_MAX)
                    ).map((row, idx, arr) => (
                      <div
                        key={row.rowNumber}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 10,
                          padding: "7px 12px",
                          borderBottom: idx < arr.length - 1 ? "1px solid #F2DDD6" : "none",
                          backgroundColor: idx % 2 === 0 ? "#FDF5F2" : "#FAF0EC",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 9.5,
                            color: "#C47A6A",
                            flexShrink: 0,
                            minWidth: 48,
                          }}
                        >
                          ROW {row.rowNumber}
                        </span>
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontSize: 13,
                            color: "#7A3020",
                          }}
                        >
                          {row.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                  {preview.invalidRows.length > INVALID_SHOW_MAX && (
                    <button
                      type="button"
                      onClick={() => setShowAllInvalid((v) => !v)}
                      style={{
                        marginTop: 8,
                        fontFamily: mono,
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: FAINT2,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {showAllInvalid
                        ? "Show fewer"
                        : `Show all ${preview.invalidRows.length} invalid rows`}
                    </button>
                  )}
                </div>
              )}

              {uploadError && (
                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: CLAY,
                    }}
                  >
                    {uploadError}
                  </span>
                </div>
              )}

              {/* Import confirm button */}
              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <Button
                  variant="primary"
                  disabled={uploading || preview.validRows.length === 0}
                  onClick={() => { if (pendingFile) void uploadFile(pendingFile); }}
                  style={{ flex: 1 }}
                >
                  {uploading
                    ? "Importing…"
                    : preview.validRows.length === 0
                      ? "No valid rows to import"
                      : `Import ${preview.validRows.length} row${preview.validRows.length === 1 ? "" : "s"}`}
                </Button>
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  Change file
                </Button>
              </div>
            </div>
          ) : (
            /* ── Dropzone (shown when no file is pending) ── */
            <>
              <div
                onClick={() => { if (!uploading) fileRef.current?.click(); }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{
                  backgroundColor: isDragOver ? "#F1E9D2" : "#F5EFDF",
                  border: `1.5px dashed ${isDragOver ? "#A99E86" : "#CBBF9F"}`,
                  borderRadius: 10,
                  padding: "50px 28px",
                  textAlign: "center",
                  cursor: uploading ? "default" : "pointer",
                  transition: "all 0.1s",
                }}
              >
                {/* Upload icon tile */}
                <div
                  style={{
                    display: "inline-flex",
                    width: 40,
                    height: 40,
                    backgroundColor: "#FCFAF3",
                    border: "1px solid #D3C9B4",
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Upload size={16} color="#5A5344" />
                </div>

                <>
                  <div
                    style={{
                      fontFamily: grotesk,
                      fontWeight: 600,
                      fontSize: 16,
                      color: INK,
                      marginTop: 16,
                    }}
                  >
                    Drop your CSV here
                  </div>
                  <div
                    style={{
                      fontFamily: grotesk,
                      fontSize: 14.5,
                      color: "#5A5344",
                      marginTop: 6,
                    }}
                  >
                    or{" "}
                    <span style={{ color: FOREST, textDecoration: "underline" }}>
                      browse files
                    </span>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: FAINT2,
                        letterSpacing: "0.06em",
                        lineHeight: 1.8,
                      }}
                    >
                      businessName · contactEmail · contactName
                      <br />
                      keyPoints · leadSource · campaignId
                    </div>
                  </div>
                </>
              </div>
              {uploadError && (
                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: CLAY,
                    }}
                  >
                    {uploadError}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Maps Scraper tab */}
      {tab === "scraper" && (
        <div style={{ marginTop: 18 }}>
          <input
            ref={scraperFileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={handleScraperFileChange}
          />

          {/* Default channel select */}
          <div style={{ marginBottom: 18 }}>
            <label style={monoLabel}>DEFAULT CHANNEL</label>
            <select
              className={inputClass}
              value={defaultChannel}
              onChange={(e) => setDefaultChannel(e.target.value as NonEmailChannel)}
            >
              <option value="facebook">Facebook</option>
              <option value="instagram">Instagram</option>
              <option value="phone">Phone</option>
            </select>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: FAINT2,
                letterSpacing: "0.04em",
                marginTop: 8,
                lineHeight: 1.6,
              }}
            >
              Used when a business has that handle — otherwise falls back to Facebook → Instagram → Phone.
            </div>
          </div>

          {/* ── Preview panel (shown after file is selected) ── */}
          {scraperParsed && scraperPreview && scraperPendingFile ? (
            <div>
              {/* Preview header */}
              <Panel style={{ padding: "18px 20px 16px" }}>
                {/* Title row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.12em",
                        color: FAINT,
                      }}
                    >
                      Preview
                    </span>
                    <div
                      style={{
                        fontFamily: grotesk,
                        fontWeight: 600,
                        fontSize: 15,
                        color: INK,
                        marginTop: 4,
                      }}
                    >
                      {scraperPendingFile.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleScraperCancelPreview}
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: FAINT2,
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px 6px",
                      flexShrink: 0,
                    }}
                  >
                    Cancel
                  </button>
                </div>

                {/* Stat bar */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 14,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: scraperPreview.ready.length > 0 ? "#EAF2E7" : "#F5EFDF",
                      border: `1px solid ${scraperPreview.ready.length > 0 ? "#C6D8C0" : "#CBBF9F"}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: serif,
                        fontSize: 28,
                        fontWeight: 400,
                        color: scraperPreview.ready.length > 0 ? "#1C6E3A" : "#7A7263",
                        lineHeight: 1,
                      }}
                    >
                      {scraperPreview.ready.length}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: scraperPreview.ready.length > 0 ? "#1C6E3A" : "#7A7263",
                        marginTop: 6,
                      }}
                    >
                      Ready to import
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: scraperPreview.skipped > 0 ? "#F7E8E2" : "#F5EFDF",
                      border: `1px solid ${scraperPreview.skipped > 0 ? "#E0C4B8" : "#CBBF9F"}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: serif,
                        fontSize: 28,
                        fontWeight: 400,
                        color: scraperPreview.skipped > 0 ? "#A23B28" : "#7A7263",
                        lineHeight: 1,
                      }}
                    >
                      {scraperPreview.skipped}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 9.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: scraperPreview.skipped > 0 ? "#A23B28" : "#7A7263",
                        marginTop: 6,
                      }}
                    >
                      Will skip
                    </div>
                  </div>
                </div>

                {/* Scope note */}
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: FAINT2,
                    letterSpacing: "0.05em",
                    marginTop: 12,
                    lineHeight: 1.6,
                  }}
                >
                  Suppressed and duplicate rows are detected on import — not shown here.
                </div>
              </Panel>

              {/* Ready rows sample table */}
              {scraperPreview.ready.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: FAINT2,
                      marginBottom: 8,
                    }}
                  >
                    {scraperPreview.ready.length > SAMPLE_MAX
                      ? `Sample — first ${SAMPLE_MAX} of ${scraperPreview.ready.length} ready rows`
                      : `Ready rows`}
                  </div>
                  <div
                    style={{
                      border: "1px solid #D3C9B4",
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    {/* Table header */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "3fr 2fr 3fr",
                        backgroundColor: "#F0EBE0",
                        borderBottom: "1px solid #D3C9B4",
                        padding: "6px 12px",
                      }}
                    >
                      {["Business", "Channel", "Handle"].map((h) => (
                        <span
                          key={h}
                          style={{
                            fontFamily: mono,
                            fontSize: 9.5,
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            color: FAINT2,
                          }}
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                    {/* Table rows */}
                    {scraperPreview.ready.slice(0, SAMPLE_MAX).map((row, idx) => (
                      <div
                        key={`${row.businessName}-${idx}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "3fr 2fr 3fr",
                          padding: "8px 12px",
                          borderBottom: idx < Math.min(scraperPreview.ready.length, SAMPLE_MAX) - 1
                            ? "1px solid #EAE3D5"
                            : "none",
                          backgroundColor: idx % 2 === 0 ? "#FCFAF3" : "#F8F5EC",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontSize: 13,
                            color: INK,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.businessName}
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            color: FAINT2,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {row.channel}
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 11.5,
                            color: "#5A5344",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.handle}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadError && (
                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: CLAY,
                    }}
                  >
                    {uploadError}
                  </span>
                </div>
              )}

              {/* Import confirm button */}
              <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                <Button
                  variant="primary"
                  disabled={uploading || scraperPreview.ready.length === 0}
                  onClick={() => {
                    if (scraperPendingFile) {
                      void uploadFile(scraperPendingFile, { format: "scraper", defaultChannel });
                    }
                  }}
                  style={{ flex: 1 }}
                >
                  {uploading
                    ? "Importing…"
                    : scraperPreview.ready.length === 0
                      ? "No valid rows to import"
                      : `Import ${scraperPreview.ready.length} row${scraperPreview.ready.length === 1 ? "" : "s"}`}
                </Button>
                <Button
                  variant="outline"
                  disabled={uploading}
                  onClick={() => scraperFileRef.current?.click()}
                >
                  Change file
                </Button>
              </div>
            </div>
          ) : (
            /* ── Dropzone (shown when no file is pending) ── */
            <>
              <div
                onClick={() => { if (!uploading) scraperFileRef.current?.click(); }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleScraperDrop}
                style={{
                  backgroundColor: isDragOver ? "#F1E9D2" : "#F5EFDF",
                  border: `1.5px dashed ${isDragOver ? "#A99E86" : "#CBBF9F"}`,
                  borderRadius: 10,
                  padding: "50px 28px",
                  textAlign: "center",
                  cursor: uploading ? "default" : "pointer",
                  transition: "all 0.1s",
                }}
              >
                {/* Upload icon tile */}
                <div
                  style={{
                    display: "inline-flex",
                    width: 40,
                    height: 40,
                    backgroundColor: "#FCFAF3",
                    border: "1px solid #D3C9B4",
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Upload size={16} color="#5A5344" />
                </div>

                <>
                  <div
                    style={{
                      fontFamily: grotesk,
                      fontWeight: 600,
                      fontSize: 16,
                      color: INK,
                      marginTop: 16,
                    }}
                  >
                    Drop your scraper CSV here
                  </div>
                  <div
                    style={{
                      fontFamily: grotesk,
                      fontSize: 14.5,
                      color: "#5A5344",
                      marginTop: 6,
                    }}
                  >
                    or{" "}
                    <span style={{ color: FOREST, textDecoration: "underline" }}>
                      browse files
                    </span>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: FAINT2,
                        letterSpacing: "0.06em",
                        lineHeight: 1.8,
                      }}
                    >
                      name · category · rating · review_count
                      <br />
                      facebook · instagram · phone · place_id
                    </div>
                  </div>
                </>
              </div>
              {uploadError && (
                <div style={{ marginTop: 14, textAlign: "center" }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: CLAY,
                    }}
                  >
                    {uploadError}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Manual tab */}
      {tab === "manual" && (
        <form
          onSubmit={handleManualAdd}
          style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div>
            <label style={monoLabel}>BUSINESS NAME *</label>
            <input
              className={inputClass}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={monoLabel}>CONTACT EMAIL *</label>
            <input
              type="email"
              className={inputClass}
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={monoLabel}>CONTACT NAME</label>
            <input
              className={inputClass}
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div>
            <label style={monoLabel}>KEY POINTS *</label>
            <textarea
              className={inputClass}
              rows={3}
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              required
            />
          </div>
          <div>
            <label style={monoLabel}>LEAD SOURCE</label>
            <select
              className={inputClass}
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value)}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {manualSuccess && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#1C6E3A",
              }}
            >
              CONTACT ADDED
            </span>
          )}
          {manualError && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: CLAY,
              }}
            >
              {manualError}
            </span>
          )}
          <Button type="submit" variant="primary" disabled={manualLoading} className="w-full">
            {manualLoading ? "Adding…" : "Add contact"}
          </Button>
        </form>
      )}

      {/* Last import panel */}
      {lastImport && (
        <div style={{ marginTop: 28 }}>
          <Panel style={{ padding: "20px 22px" }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: FAINT,
              }}
            >
              LAST IMPORT — {lastImport.fileName.toUpperCase()} · {lastImport.totalRows} ROWS
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 14,
                marginTop: 16,
              }}
            >
              {STAT_TILES.map(({ key, label, bg, border, color }) => (
                <div
                  key={key}
                  style={{
                    backgroundColor: bg,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: 16,
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: serif,
                      fontSize: 30,
                      fontWeight: 400,
                      color,
                      lineHeight: 1,
                    }}
                  >
                    {lastImport[key]}
                  </div>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 9.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color,
                      marginTop: 8,
                    }}
                  >
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

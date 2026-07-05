"use client";

import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Panel, Button, inputClass } from "@/components/ui";

// ── Design tokens ─────────────────────────────────────────────────────────────
const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";
const INK     = "#1A1712";
const FAINT   = "#8E836C";
const FAINT2  = "#9A8F76";
const CLAY    = "#BC5228";
const FOREST  = "#1C4B3A";

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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const [campaigns,  setCampaigns]  = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [tab,        setTab]        = useState<"csv" | "manual">("csv");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastImport,  setLastImport]  = useState<LastImport | null>(null);

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

  // Load campaigns
  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        const list = data as Campaign[];
        setCampaigns(list);
        if (list.length > 0) setCampaignId(list[0]._id);
      })
      .catch(() => {});
  }, []);

  // Hydrate lastImport from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setLastImport(JSON.parse(stored) as LastImport);
    } catch { /* ignore */ }
  }, []);

  async function uploadFile(file: File) {
    if (!campaignId) {
      setUploadError("No campaign selected");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("campaignId", campaignId);
      const res = await fetch("/api/contacts/import", { method: "POST", body: formData });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(body.error ?? `HTTP ${res.status}`);
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
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void uploadFile(file);
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
    if (file) void uploadFile(file);
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
        setManualError(data.error ?? `HTTP ${res.status}`);
      } else {
        setManualSuccess(true);
        setBusinessName(""); setContactEmail(""); setContactName("");
        setKeyPoints(""); setLeadSource("cold_email");
      }
    } catch (err) {
      setManualError(err instanceof Error ? err.message : String(err));
    } finally {
      setManualLoading(false);
    }
  }

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
    { key: "suppressed" as const, label: "SUPPRESSED",  bg: "#F7E8E2", border: "#E0C4B8", color: "#A23B28" },
    { key: "duplicates" as const, label: "DUPLICATES",  bg: "#F7EFD9", border: "#E2D3A8", color: "#96712A" },
    { key: "invalid"    as const, label: "INVALID",     bg: "#EFEBE0", border: "#D8CFBB", color: "#7A7263" },
  ] as const;

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
        SUPPRESSED EMAILS ARE ALWAYS SKIPPED
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
          padding: 3,
          marginTop: 18,
        }}
      >
        {(["csv", "manual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              fontFamily: grotesk,
              fontWeight: 600,
              fontSize: 14.5,
              padding: "12px",
              borderRadius: 6,
              border: tab === t ? "1px solid #D3C9B4" : "1px solid transparent",
              backgroundColor: tab === t ? "#FCFAF3" : "transparent",
              color: tab === t ? INK : "#8E836C",
              cursor: "pointer",
              transition: "all 0.1s",
            }}
          >
            {t === "csv" ? "Upload CSV" : "Add manually"}
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

            {uploading ? (
              <div style={{ marginTop: 16 }}>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: FAINT,
                  }}
                >
                  UPLOADING…
                </span>
              </div>
            ) : (
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
            )}
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
                    padding: 12,
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

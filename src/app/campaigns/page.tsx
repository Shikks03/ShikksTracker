"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Panel,
  SectionHeader,
  Button,
  inputClass,
  PIPELINE_META,
} from "@/components/ui";

// ── Design tokens ─────────────────────────────────────────────────────────────
const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";
const INK     = "#1A1712";
const FAINT   = "#8E836C";
const FAINT2  = "#9A8F76";
const CLAY    = "#BC5228";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  _id: string;
  name: string;
  offerSummary: string;
  toneNotes: string;
  sequenceSpacingDays: number[];
  createdAt: string;
}

interface CampaignStats {
  funnel: { sent: number; opened: number; clicked: number; replied: number };
  pipeline: Record<string, number>;
}

interface LeadSourceRow {
  leadSource: string;
  total: number;
  contacted: number;
  replied: number;
  won: number;
  replyRate: number;
  winRate: number;
}

const PIPELINE_STAGES = [
  "not_started",
  "contacted",
  "replied",
  "call_booked",
  "proposal_sent",
  "won",
  "lost",
] as const;

const LEAD_SOURCE_LABELS: Record<string, string> = {
  cold_email:       "Cold Email",
  referral:         "Referral",
  event_connection: "Event Connection",
  other:            "Other",
};

// ── API helper ────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${res.status}` };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function fmtCreated(dateStr: string): string {
  return new Date(dateStr)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

// ── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [stats,       setStats]       = useState<CampaignStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError,  setStatsError]  = useState<string | null>(null);

  useEffect(() => {
    setStatsLoading(true);
    apiFetch<CampaignStats>(`/api/campaigns/${campaign._id}/stats`).then(
      ({ data, error }) => {
        setStatsLoading(false);
        if (error) setStatsError(error);
        else setStats(data);
      }
    );
  }, [campaign._id]);

  const total = stats
    ? Object.values(stats.pipeline).reduce((a, b) => a + b, 0)
    : 0;

  const activeStages = PIPELINE_STAGES.filter(
    (s) => (stats?.pipeline[s] ?? 0) > 0
  );

  return (
    <Panel style={{ padding: "22px 28px" }}>
      {/* Row 1 */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: serif,
            fontSize: 23,
            color: INK,
            letterSpacing: "-0.01em",
          }}
        >
          {campaign.name}
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: FAINT2,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          CREATED {fmtCreated(campaign.createdAt)} · {total} CONTACTS
        </span>
      </div>

      {/* Row 2 – funnel bar */}
      <div
        style={{
          marginTop: 16,
          height: 12,
          borderRadius: 6,
          overflow: "hidden",
          display: "flex",
          backgroundColor: "#E4DBC8",
        }}
      >
        {(statsLoading || statsError || !stats || activeStages.length === 0) && (
          <div style={{ flex: 1, backgroundColor: "#E4DBC8" }} />
        )}
        {!statsLoading && !statsError && stats && activeStages.length > 0 &&
          activeStages.map((s) => (
            <div
              key={s}
              style={{
                flex: stats.pipeline[s] ?? 0,
                backgroundColor: PIPELINE_META[s].color,
              }}
            />
          ))
        }
      </div>

      {/* Row 3 – legend / loading / error */}
      <div style={{ marginTop: 14 }}>
        {statsLoading && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: FAINT,
            }}
          >
            LOADING…
          </span>
        )}
        {!statsLoading && statsError && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: CLAY,
            }}
          >
            {statsError}
          </span>
        )}
        {!statsLoading && !statsError && stats && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {activeStages.map((s) => (
              <span
                key={s}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: mono,
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#7A6E52",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 1,
                    backgroundColor: PIPELINE_META[s].color,
                    flexShrink: 0,
                  }}
                />
                {PIPELINE_META[s].label.toUpperCase()} {stats.pipeline[s] ?? 0}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [campaigns,   setCampaigns]   = useState<Campaign[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);

  // Create form
  const [name,          setName]          = useState("");
  const [offerSummary,  setOfferSummary]  = useState("");
  const [toneNotes,     setToneNotes]     = useState("");
  const [day0,          setDay0]          = useState("0");
  const [day1,          setDay1]          = useState("5");
  const [day2,          setDay2]          = useState("9");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError,   setCreateError]   = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const formRef      = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [campaignsRes, lsRes] = await Promise.all([
      apiFetch<Campaign[]>("/api/campaigns"),
      apiFetch<LeadSourceRow[]>("/api/stats/lead-sources"),
    ]);
    if (campaignsRes.error) setError(campaignsRes.error);
    else setCampaigns(campaignsRes.data ?? []);
    setLeadSources(lsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  function focusForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => nameInputRef.current?.focus(), 300);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateLoading(true);
    setCreateError(null);
    const { error: err } = await apiFetch("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name,
        offerSummary,
        toneNotes,
        sequenceSpacingDays: [
          parseInt(day0, 10) || 0,
          parseInt(day1, 10) || 5,
          parseInt(day2, 10) || 9,
        ],
      }),
    });
    setCreateLoading(false);
    if (err) { setCreateError(err); return; }
    setName(""); setOfferSummary(""); setToneNotes("");
    setDay0("0"); setDay1("5"); setDay2("9");
    loadAll();
  }

  const monoFieldLabel: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: FAINT2,
    display: "block",
    marginBottom: 7,
  };

  const LS_COL_NUMS: Array<keyof LeadSourceRow> = ["total", "contacted", "replied", "won"];

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: FAINT,
              display: "block",
              marginBottom: 10,
            }}
          >
            {campaigns.length} ACTIVE CAMPAIGNS
          </span>
          <h1
            style={{
              fontFamily: serif,
              fontSize: 40,
              fontWeight: 400,
              color: INK,
              letterSpacing: "-0.01em",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Campaigns
          </h1>
        </div>
        <Button variant="primary" onClick={focusForm} style={{ marginTop: 6, flexShrink: 0 }}>
          + New campaign
        </Button>
      </div>

      {/* Body */}
      <div
        style={{
          display: "flex",
          gap: 28,
          alignItems: "flex-start",
          marginTop: 28,
        }}
      >
        {/* LEFT */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {loading && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: FAINT,
                display: "block",
                textAlign: "center",
                padding: "56px 0",
              }}
            >
              LOADING…
            </span>
          )}
          {!loading && error && (
            <Panel style={{ padding: "22px 28px" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: CLAY, textTransform: "uppercase" }}>
                {error}
              </span>
            </Panel>
          )}
          {!loading && !error && campaigns.length === 0 && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: FAINT,
                display: "block",
                textAlign: "center",
                padding: "56px 0",
              }}
            >
              NO CAMPAIGNS YET · CREATE ONE TO START
            </span>
          )}
          {campaigns.map((c) => (
            <CampaignCard key={c._id} campaign={c} />
          ))}

          {/* Lead sources */}
          {leadSources.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <SectionHeader title="LEAD SOURCES" />
              <div style={{ marginTop: 14 }}>
                <Panel style={{ padding: 0, overflow: "hidden" }}>
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr repeat(6, 1fr)",
                      padding: "14px 22px",
                      borderBottom: "1px solid #E4DBC8",
                    }}
                  >
                    {["SOURCE", "TOTAL", "CONTACTED", "REPLIED", "WON", "REPLY RATE", "WIN RATE"].map(
                      (col, i) => (
                        <span
                          key={col}
                          style={{
                            fontFamily: mono,
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.1em",
                            color: FAINT,
                            textAlign: i === 0 ? "left" : "right",
                          }}
                        >
                          {col}
                        </span>
                      )
                    )}
                  </div>
                  {/* Data rows */}
                  {leadSources.map((row, idx) => (
                    <div key={row.leadSource}>
                      {idx > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.4fr repeat(6, 1fr)",
                          padding: "14px 22px",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontWeight: 600,
                            fontSize: 14.5,
                            color: INK,
                          }}
                        >
                          {LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource}
                        </span>
                        {LS_COL_NUMS.map((key) => (
                          <span
                            key={key}
                            style={{
                              fontFamily: mono,
                              fontSize: 12,
                              color: "#5A5344",
                              textAlign: "right",
                            }}
                          >
                            {row[key] as number}
                          </span>
                        ))}
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 12,
                            color: "#5A5344",
                            textAlign: "right",
                          }}
                        >
                          {(row.replyRate * 100).toFixed(1)}%
                        </span>
                        <span
                          style={{
                            fontFamily: mono,
                            fontSize: 12,
                            color: "#5A5344",
                            textAlign: "right",
                          }}
                        >
                          {(row.winRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </Panel>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT – Create form */}
        <div ref={formRef} style={{ width: 300, flexShrink: 0 }}>
          <Panel style={{ padding: "26px 28px" }}>
            <h2
              style={{
                fontFamily: serif,
                fontSize: 23,
                fontWeight: 400,
                color: INK,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Create a campaign
            </h2>
            <form onSubmit={handleCreate}>
              {/* Campaign name */}
              <div style={{ marginTop: 18 }}>
                <label style={monoFieldLabel}>CAMPAIGN NAME</label>
                <input
                  ref={nameInputRef}
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Q4 Cebu Push"
                  required
                />
              </div>

              {/* Offer summary */}
              <div style={{ marginTop: 18 }}>
                <label style={{ ...monoFieldLabel, marginBottom: 7 }}>
                  OFFER SUMMARY{" "}
                  <span style={{ color: "#96712A" }}>· FED TO CLAUDE</span>
                </label>
                <textarea
                  className={inputClass}
                  rows={2}
                  value={offerSummary}
                  onChange={(e) => setOfferSummary(e.target.value)}
                  placeholder="1-week homepage tune-up for SMBs…"
                  required
                  style={{ resize: "vertical" }}
                />
              </div>

              {/* Tone notes */}
              <div style={{ marginTop: 18 }}>
                <label style={monoFieldLabel}>TONE NOTES</label>
                <input
                  className={inputClass}
                  value={toneNotes}
                  onChange={(e) => setToneNotes(e.target.value)}
                  placeholder="Warm, Taglish, relationship-first"
                />
              </div>

              {/* Sequence spacing */}
              <div style={{ marginTop: 18 }}>
                <label style={monoFieldLabel}>SEQUENCE SPACING</label>
                <div style={{ display: "flex", gap: 10 }}>
                  {[
                    { val: day0, set: setDay0 },
                    { val: day1, set: setDay1 },
                    { val: day2, set: setDay2 },
                  ].map(({ val, set }, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        backgroundColor: "#FCFAF3",
                        border: "1px solid #D3C9B4",
                        borderRadius: 7,
                        overflow: "hidden",
                        flex: 1,
                      }}
                    >
                      <input
                        type="number"
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        min="0"
                        style={{
                          flex: 1,
                          border: "none",
                          background: "transparent",
                          fontFamily: mono,
                          fontSize: 14.5,
                          color: INK,
                          textAlign: "center",
                          padding: "12px 0 12px 12px",
                          outline: "none",
                          minWidth: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 12,
                          color: FAINT2,
                          paddingRight: 8,
                          flexShrink: 0,
                        }}
                      >
                        d
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {createError && (
                <div style={{ marginTop: 16 }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: CLAY,
                    }}
                  >
                    {createError}
                  </span>
                </div>
              )}

              <div style={{ marginTop: 22 }}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={createLoading}
                  className="w-full"
                >
                  {createLoading ? "Creating…" : "Create campaign"}
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

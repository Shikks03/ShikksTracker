"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  MonoLabel,
  Panel,
  InitialsTile,
  PIPELINE_META,
  Button,
} from "@/components/ui";
import {
  serif, grotesk, mono, INK, FAINT, FAINT2, CLAY,
  FOREST_WON as FOREST,
} from "@/components/tokens";
import { apiFetch, HOT_THRESHOLD } from "@/lib/client";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ordinal(n: 1 | 2 | 3): string {
  if (n === 1) return "1ST";
  if (n === 2) return "2ND";
  return "3RD";
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Static maps ───────────────────────────────────────────────────────────────

const LEAD_SOURCE_MAP: Record<string, string> = {
  cold_email:       "COLD EMAIL",
  referral:         "REFERRAL",
  event_connection: "EVENT",
  other:            "OTHER",
};

// Pipeline stage numeric order
const PIPELINE_ORDER: Record<string, number> = {
  not_started:   0,
  contacted:     1,
  replied:       2,
  call_booked:   3,
  proposal_sent: 4,
  won:           5,
  lost:          5,
};

// The 4 non-terminal checklist rows
const CHECKLIST_ROWS = [
  { key: "contacted",     label: "Contacted" },
  { key: "replied",       label: "Replied" },
  { key: "call_booked",   label: "Call Booked" },
  { key: "proposal_sent", label: "Proposal Sent" },
];

// Advance-to mapping (only stages that can advance)
const ADVANCE_TO: Record<string, string> = {
  not_started:   "contacted",
  contacted:     "replied",
  replied:       "call_booked",
  call_booked:   "proposal_sent",
};

const ADVANCE_LABEL: Record<string, string> = {
  not_started:   "Contacted",
  contacted:     "Replied",
  replied:       "Call Booked",
  call_booked:   "Proposal Sent",
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface Contact {
  _id: string;
  businessName: string;
  contactName?: string;
  contactEmail: string;
  leadSource: string;
  keyPoints: string;
  status: string;
  pipelineStage: string;
  engagementScore: number;
  campaignId?: string;
}

interface EmailLog {
  _id: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved" | "sent";
  subject: string;
  body: string;
  sentAt: string | null;
  openCount: number;
  clickCount: number;
  replied: boolean;
  repliedAt: string | null;
  replyBody?: string | null;
  replySnippet?: string | null;
}

interface Campaign {
  _id: string;
  name: string;
}

// ── API helper ────────────────────────────────────────────────────────────────

// ── Thread builder ────────────────────────────────────────────────────────────

type ThreadItem =
  | { kind: "outbound"; log: EmailLog; sortDate: number }
  | { kind: "inbound";  log: EmailLog; sortDate: number }
  | { kind: "pending";  log: EmailLog };

type DatedItem = Extract<ThreadItem, { sortDate: number }>;

function buildThread(logs: EmailLog[]): ThreadItem[] {
  const dated: DatedItem[]    = [];
  const pending: ThreadItem[] = [];

  for (const log of logs) {
    if (log.status === "sent") {
      const sentTime = log.sentAt ? new Date(log.sentAt).getTime() : 0;
      dated.push({ kind: "outbound", log, sortDate: sentTime });
      if (log.replied) {
        const repliedTime = log.repliedAt ? new Date(log.repliedAt).getTime() : 0;
        dated.push({ kind: "inbound", log, sortDate: repliedTime });
      }
    } else {
      pending.push({ kind: "pending", log });
    }
  }

  // Newest dated items first
  dated.sort((a, b) => b.sortDate - a.sortDate);

  // Pending: highest stage first
  pending.sort((a, b) => b.log.stage - a.log.stage);

  return [...dated, ...pending];
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [contact,   setContact]   = useState<Contact | null>(null);
  const [logs,      setLogs]      = useState<EmailLog[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Key points editing
  const [keyPoints, setKeyPoints] = useState("");
  const [kpSaving,  setKpSaving]  = useState(false);
  const [kpMsg,     setKpMsg]     = useState<string | null>(null);

  // Generic patch (pipeline / status)
  const [saving,   setSaving]   = useState(false);
  const [patchMsg, setPatchMsg] = useState<string | null>(null);

  // Breadcrumb hover
  const [dashHovered, setDashHovered] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [contactRes, logsRes, campaignsRes] = await Promise.all([
      apiFetch<Contact>(`/api/contacts/${id}`),
      apiFetch<EmailLog[]>(`/api/email-logs?contactId=${id}`),
      apiFetch<Campaign[]>("/api/campaigns"),
    ]);
    if (contactRes.error) {
      setError(contactRes.error);
      setLoading(false);
      return;
    }
    if (contactRes.data) {
      setContact(contactRes.data);
      setKeyPoints(contactRes.data.keyPoints ?? "");
    }
    if (logsRes.data)      setLogs(logsRes.data);
    if (campaignsRes.data) setCampaigns(campaignsRes.data);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patchContact(fields: Record<string, unknown>) {
    setSaving(true);
    const { data, error } = await apiFetch<Contact>(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    setSaving(false);
    if (error) { setPatchMsg(`Error: ${error}`); return; }
    if (data)  { setContact(data); }
    setPatchMsg("Saved.");
    setTimeout(() => setPatchMsg(null), 2000);
  }

  async function handleSaveKeyPoints() {
    setKpSaving(true);
    const { data, error } = await apiFetch<Contact>(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ keyPoints }),
    });
    setKpSaving(false);
    if (error) { setKpMsg(`Error: ${error}`); return; }
    if (data)  { setContact(data); }
    setKpMsg("Saved.");
    setTimeout(() => setKpMsg(null), 2000);
  }

  // ── Loading / error / not-found states ────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: "30px 40px", textAlign: "center", paddingTop: 84 }}>
        <MonoLabel style={{ color: FAINT, fontSize: 12, letterSpacing: "0.14em" }}>
          LOADING…
        </MonoLabel>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "30px 40px" }}>
        <Panel style={{ padding: "22px 28px" }}>
          <MonoLabel style={{ color: CLAY }}>{error}</MonoLabel>
        </Panel>
      </div>
    );
  }

  if (!contact) {
    return (
      <div style={{ padding: "30px 40px", textAlign: "center", paddingTop: 84 }}>
        <MonoLabel style={{ color: FAINT, fontSize: 12, letterSpacing: "0.14em" }}>
          CONTACT NOT FOUND
        </MonoLabel>
      </div>
    );
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const score       = contact.engagementScore ?? 0;
  const isHot       = score >= HOT_THRESHOLD;
  const campaignName = campaigns.find((c) => c._id === contact.campaignId)?.name ?? "";
  const isWonOrLost  = contact.pipelineStage === "won" || contact.pipelineStage === "lost";
  const currentOrder = PIPELINE_ORDER[contact.pipelineStage] ?? 0;
  const advanceTo    = ADVANCE_TO[contact.pipelineStage];
  const advanceLabel = ADVANCE_LABEL[contact.pipelineStage];

  // Meta line: only non-empty segments
  const metaParts: string[] = [];
  if (contact.contactName) metaParts.push(contact.contactName.toUpperCase());
  metaParts.push(contact.contactEmail.toUpperCase());
  if (contact.leadSource)  metaParts.push(LEAD_SOURCE_MAP[contact.leadSource] ?? contact.leadSource.toUpperCase());
  if (campaignName)         metaParts.push(campaignName.toUpperCase());

  // Contact first name for inbound captions
  const contactFirstName = contact.contactName
    ? contact.contactName.split(" ")[0].toUpperCase()
    : contact.contactEmail.split("@")[0].toUpperCase();

  const thread = buildThread(logs);

  const keyPointsDirty = keyPoints !== (contact.keyPoints ?? "");

  return (
    <div className="page-enter" style={{ padding: "30px 40px 56px" }}>

      {/* ── 1. BREADCRUMB ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link
          href="/"
          onMouseEnter={() => setDashHovered(true)}
          onMouseLeave={() => setDashHovered(false)}
          style={{
            fontFamily: mono,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: dashHovered ? INK : FAINT,
            textDecoration: "none",
            transition: "color 0.1s",
          }}
        >
          DASHBOARD
        </Link>
        <span
          style={{
            fontFamily: mono,
            fontSize: 11,
            color: FAINT,
            letterSpacing: "0.1em",
          }}
        >
          /
        </span>
        <span
          style={{
            fontFamily: mono,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: INK,
          }}
        >
          {contact.businessName}
        </span>
      </div>

      {/* ── 2. BODY (flex row) ── */}
      <div
        style={{
          display: "flex",
          gap: 22,
          alignItems: "flex-start",
          marginTop: 16,
        }}
      >

        {/* ── LEFT COLUMN ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ── HEADER PANEL ── */}
          <Panel style={{ padding: "22px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>

              {/* Initials tile */}
              <InitialsTile name={contact.businessName} size={56} />

              {/* Middle */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Line 1: serif name + HOT · {score} chip */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: serif,
                      fontSize: 30,
                      fontWeight: 400,
                      color: INK,
                      letterSpacing: "-0.01em",
                      lineHeight: 1.1,
                    }}
                  >
                    {contact.businessName}
                  </span>
                  {isHot && (
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        border: "1px solid #D8B45E",
                        color: "#8A6212",
                        backgroundColor: "#F3E9CE",
                        borderRadius: 4,
                        padding: "2px 8px",
                        lineHeight: 1.6,
                        flexShrink: 0,
                      }}
                    >
                      HOT · {score}
                    </span>
                  )}
                </div>

                {/* Line 2: mono meta */}
                <div
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: FAINT2,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginTop: 7,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {metaParts.join(" · ")}
                </div>
              </div>

              {/* Right: Pause/Resume button or status label */}
              <div style={{ flexShrink: 0 }}>
                {contact.status === "active" && (
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => patchContact({ status: "paused" })}
                  >
                    Pause
                  </Button>
                )}
                {contact.status === "paused" && (
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => patchContact({ status: "active" })}
                  >
                    Resume
                  </Button>
                )}
                {contact.status !== "active" && contact.status !== "paused" && (
                  <MonoLabel
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      color:
                        contact.status === "unsubscribed" ||
                        contact.status === "bounced"
                          ? CLAY
                          : FAINT,
                    }}
                  >
                    {contact.status.toUpperCase()}
                  </MonoLabel>
                )}
              </div>
            </div>
          </Panel>

          {/* ── CONVERSATION THREAD ── */}
          <div
            style={{
              marginTop: 22,
              display: "flex",
              flexDirection: "column",
              gap: 18,
            }}
          >
            {thread.length === 0 && (
              <div style={{ textAlign: "center", padding: "56px 0" }}>
                <MonoLabel
                  style={{
                    color: FAINT,
                    fontSize: 11,
                    letterSpacing: "0.1em",
                  }}
                >
                  NO EMAILS YET · SEQUENCE STARTS ON THE NEXT RUN
                </MonoLabel>
              </div>
            )}

            {thread.map((item, idx) => {

              /* ── INBOUND bubble ── */
              if (item.kind === "inbound") {
                const log  = item.log;
                const text = log.replyBody ?? log.replySnippet ?? null;
                return (
                  <div key={`inbound-${log._id}-${idx}`} style={{ maxWidth: "64%" }}>
                    <div
                      style={{
                        backgroundColor: "#F3EFE3",
                        border: "1px solid #DDD1B8",
                        borderRadius: "12px 12px 12px 3px",
                        padding: "16px 22px",
                      }}
                    >
                      {text ? (
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontSize: 15.5,
                            color: "#2A251C",
                            lineHeight: 1.6,
                            whiteSpace: "pre-wrap",
                            display: "block",
                          }}
                        >
                          {text}
                        </span>
                      ) : (
                        <MonoLabel
                          style={{
                            color: FAINT,
                            fontSize: 10.5,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          REPLIED — OPEN GMAIL FOR THE MESSAGE
                        </MonoLabel>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: FAINT2,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginTop: 7,
                      }}
                    >
                      {contactFirstName} · REPLIED {fmtDateTime(log.repliedAt)}
                    </div>
                  </div>
                );
              }

              /* ── OUTBOUND bubble ── */
              if (item.kind === "outbound") {
                const log     = item.log;
                const body    = log.body ?? "";
                const preview = body.slice(0, 140);
                return (
                  <div
                    key={`outbound-${log._id}-${idx}`}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "#161310",
                        borderRadius: "12px 12px 3px 12px",
                        padding: "16px 22px",
                        maxWidth: "64%",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: grotesk,
                          fontWeight: 600,
                          fontSize: 15.5,
                          color: "#F4EEDF",
                        }}
                      >
                        {log.subject}
                      </div>
                      <div
                        style={{
                          fontFamily: grotesk,
                          fontSize: 14.5,
                          color: "#CFC6B4",
                          lineHeight: 1.55,
                          marginTop: 6,
                        }}
                      >
                        {preview}
                        {body.length > 140 ? "…" : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: FAINT2,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginTop: 7,
                      }}
                    >
                      SENT {fmtShortDate(log.sentAt)} · OPEN {log.openCount}× · CLICK {log.clickCount}×
                    </div>
                  </div>
                );
              }

              /* ── PENDING row ── */
              if (item.kind === "pending") {
                const log   = item.log;
                const label =
                  log.status === "approved"
                    ? "APPROVED · QUEUED"
                    : "DRAFT PENDING REVIEW";
                return (
                  <div
                    key={`pending-${log._id}-${idx}`}
                    style={{ display: "flex", justifyContent: "flex-end" }}
                  >
                    <Link href="/review" style={{ textDecoration: "none" }}>
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10.5,
                          color: FAINT2,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          border: "1px solid #D8CFBB",
                          borderRadius: 5,
                          padding: "6px 14px",
                          display: "inline-block",
                        }}
                      >
                        {ordinal(log.stage)} TOUCH · {label}
                      </span>
                    </Link>
                  </div>
                );
              }

              return null;
            })}
          </div>
        </div>

        {/* ── RIGHT RAIL ── */}
        <div
          style={{
            width: 288,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >

          {/* ── PIPELINE PANEL ── */}
          <Panel style={{ padding: "22px 26px" }}>
            <MonoLabel
              style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT }}
            >
              PIPELINE
            </MonoLabel>

            {/* Patch message */}
            {patchMsg && (
              <div style={{ marginTop: 10 }}>
                <MonoLabel
                  style={{
                    fontSize: 10.5,
                    color: patchMsg.startsWith("Error") ? CLAY : "#5A7D5A",
                  }}
                >
                  {patchMsg}
                </MonoLabel>
              </div>
            )}

            {/* Checklist rows */}
            <div
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {CHECKLIST_ROWS.map((row) => {
                const rowOrder    = PIPELINE_ORDER[row.key] ?? 0;
                const isCompleted = rowOrder < currentOrder;
                const isCurrent   = rowOrder === currentOrder;
                const isUpcoming  = rowOrder > currentOrder;
                const rowColor    = PIPELINE_META[row.key]?.color ?? "#A99E86";

                return (
                  <div
                    key={row.key}
                    style={{ display: "flex", alignItems: "center", gap: 14 }}
                  >
                    {/* Circle */}
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        backgroundColor: isCompleted
                          ? FOREST
                          : isCurrent
                          ? rowColor
                          : "transparent",
                        border: isUpcoming ? "1.5px solid #C9BEA6" : "none",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {isCompleted && (
                        <Check size={11} color="#FFFFFF" strokeWidth={2.5} />
                      )}
                    </div>

                    {/* Label */}
                    <span
                      style={{
                        fontFamily: grotesk,
                        fontSize: 14.5,
                        color: isCompleted ? INK : isCurrent ? rowColor : "#8E836C",
                        fontWeight: isCurrent ? 600 : 400,
                      }}
                    >
                      {row.label}
                    </span>
                  </div>
                );
              })}

              {/* Won / Lost row */}
              {(() => {
                if (contact.pipelineStage === "won") {
                  // CURRENT at order 5 → filled green, label "Won"
                  const wonColor = PIPELINE_META.won?.color ?? FOREST;
                  return (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 14 }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          backgroundColor: wonColor,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: grotesk,
                          fontSize: 14.5,
                          color: wonColor,
                          fontWeight: 600,
                        }}
                      >
                        Won
                      </span>
                    </div>
                  );
                }
                if (contact.pipelineStage === "lost") {
                  // CURRENT at order 5 → filled brick, label "Lost"
                  const lostColor = PIPELINE_META.lost?.color ?? "#A23B28";
                  return (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 14 }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          backgroundColor: lostColor,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          fontFamily: grotesk,
                          fontSize: 14.5,
                          color: lostColor,
                          fontWeight: 600,
                        }}
                      >
                        Lost
                      </span>
                    </div>
                  );
                }
                // UPCOMING → empty ring, "Won / Lost"
                return (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 14 }}
                  >
                    <div
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        border: "1.5px solid #C9BEA6",
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontFamily: grotesk,
                        fontSize: 14.5,
                        color: "#8E836C",
                      }}
                    >
                      Won / Lost
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Advance + Won/Lost buttons */}
            <div
              style={{
                marginTop: 18,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* Advance button — hidden when proposal_sent/won/lost */}
              {advanceTo && (
                <Button
                  variant="primary"
                  disabled={saving}
                  style={{ width: "100%" }}
                  onClick={() => patchContact({ pipelineStage: advanceTo })}
                >
                  Advance → {advanceLabel}
                </Button>
              )}

              {/* Won / Lost split row — hidden when already won/lost */}
              {!isWonOrLost && (
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    disabled={saving}
                    onClick={() => patchContact({ pipelineStage: "won" })}
                    style={{
                      flex: 1,
                      fontFamily: grotesk,
                      fontSize: 15.5,
                      fontWeight: 500,
                      color: FOREST,
                      border: "1px solid #B5CBB5",
                      backgroundColor: "transparent",
                      borderRadius: 7,
                      padding: "12px 20px",
                      cursor: "pointer",
                      transition: "background-color 0.1s",
                    }}
                  >
                    Won
                  </button>
                  <button
                    disabled={saving}
                    onClick={() => patchContact({ pipelineStage: "lost" })}
                    style={{
                      flex: 1,
                      fontFamily: grotesk,
                      fontSize: 15.5,
                      fontWeight: 500,
                      color: "#A23B28",
                      border: "1px solid #D3C0B4",
                      backgroundColor: "transparent",
                      borderRadius: 7,
                      padding: "12px 20px",
                      cursor: "pointer",
                      transition: "background-color 0.1s",
                    }}
                  >
                    Lost
                  </button>
                </div>
              )}

              {/* Closed label — shown when won/lost */}
              {isWonOrLost && (
                <div style={{ textAlign: "center" }}>
                  <MonoLabel
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      color:
                        contact.pipelineStage === "won" ? FOREST : "#A23B28",
                    }}
                  >
                    CLOSED · {contact.pipelineStage.toUpperCase()}
                  </MonoLabel>
                </div>
              )}
            </div>
          </Panel>

          {/* ── KEY POINTS PANEL ── */}
          <Panel style={{ padding: "22px 26px" }}>
            <MonoLabel
              style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT }}
            >
              KEY POINTS
            </MonoLabel>

            <textarea
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              style={{
                fontFamily: grotesk,
                fontSize: 14.5,
                color: "#2A251C",
                lineHeight: 1.6,
                backgroundColor: "transparent",
                border: "none",
                outline: "none",
                width: "100%",
                minHeight: 110,
                resize: "vertical",
                marginTop: 14,
                padding: 0,
                boxSizing: "border-box",
              }}
            />

            {/* Save button + message */}
            {keyPointsDirty && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <Button
                  variant="primary"
                  disabled={kpSaving}
                  onClick={handleSaveKeyPoints}
                >
                  {kpSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            )}

            {kpMsg && (
              <div style={{ marginTop: 8 }}>
                <MonoLabel
                  style={{
                    fontSize: 10.5,
                    color: kpMsg.startsWith("Error") ? CLAY : "#5A7D5A",
                  }}
                >
                  {kpMsg}
                </MonoLabel>
              </div>
            )}
          </Panel>

        </div>
      </div>
    </div>
  );
}

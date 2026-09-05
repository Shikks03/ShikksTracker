"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Panel, Button, MonoLabel, PipelineMarker } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY } from "@/components/tokens";
import { ChannelBadge, TierBadge, ClaimedBadge } from "@/components/ChannelBadges";
import { apiFetch } from "@/lib/client";
import { toastSuccess } from "@/lib/toast";
import { normalizeHandleUrl, telHref, type Channel } from "@/lib/channels";

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors the GET /api/outreach-logs contract (Phase 4, built in parallel;
// defaults to both draft and approved logs — see resolveOutreachLogStatusFilter
// in src/lib/outreachLogs.ts).
//
// This board shows facebook + instagram + phone (`?channel=...`, see
// OUTREACH_BOARD_CHANNELS in src/lib/outreachLogs.ts).
//
// P2's lane split (2026-08-30) briefly moved facebook to /messenger, which had
// the conversation context a DM draft was easier to review against. That page
// is gone as of S15 (2026-09-05) along with the whole inbound Messenger lane,
// so facebook is back here — and this is now the ONLY place a facebook draft
// can be read and marked sent. Facebook outreach itself never stopped: drafts
// are AI-written and sent BY HAND, exactly like instagram and phone.

interface OutreachContact {
  _id: string;
  businessName: string;
  contactName?: string;
  outreachChannel: Channel;
  phone?: string;
  facebook?: string;
  instagram?: string;
  website?: string;
  webPresenceTier?: string;
  claimed?: string;
  keyPoints: string;
  pipelineStage: string;
  currentStage: number;
}

/** The channels this board renders, post lane-split. Facebook still exists as
 *  a non-email channel elsewhere (see the module doc above) — it simply never
 *  appears in a response this page's fetch can produce. */
type BoardChannel = "instagram" | "phone";

interface OutreachLogItem {
  _id: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved" | "sent";
  channel: BoardChannel;
  subject: string;
  body: string;
  createdAt?: string;
  contact: OutreachContact;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Where the "contact" link on a task row should go, given the log's channel. */
function buildContactLink(
  channel: BoardChannel,
  contact: OutreachContact
): { href: string; label: string; external: boolean } | null {
  if (channel === "phone") {
    if (!contact.phone) return null;
    return { href: telHref(contact.phone), label: contact.phone, external: false };
  }
  if (contact.instagram) {
    return { href: normalizeHandleUrl(contact.instagram, "instagram"), label: "Open Instagram →", external: true };
  }
  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const [logs,    setLogs]    = useState<OutreachLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  /** One row expanded at a time — the body/key points only render once the
   *  row is opened, which is most of the density win over the old always-open
   *  cards. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Copy-to-clipboard feedback, per card, auto-clears after ~2s
  const [copiedIds,  setCopiedIds]  = useState<Set<string>>(new Set());
  const [copyErrors, setCopyErrors] = useState<Record<string, string>>({});
  const copyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Mark-sent in-flight state, per card. A ref mirrors the Set so the
  // double-submit guard is checked synchronously — setState alone can't
  // prevent a second click landing before the first re-render commits.
  const markingRef = useRef<Set<string>>(new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [markErrors, setMarkErrors] = useState<Record<string, string>>({});

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    // facebook + instagram + phone. See OUTREACH_BOARD_CHANNELS.
    // The no-param default on the API stays ALL non-email channels; this page
    // is the one caller that deliberately narrows it.
    const { data, error: err } = await apiFetch<OutreachLogItem[]>(
      "/api/outreach-logs?channel=instagram,phone"
    );
    setLoading(false);
    if (err) { setError(err); return; }
    setLogs(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  // Clean up any pending copy-feedback timers on unmount
  useEffect(() => {
    const timers = copyTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  async function handleCopy(log: OutreachLogItem) {
    setCopyErrors((prev) => {
      if (!(log._id in prev)) return prev;
      const next = { ...prev };
      delete next[log._id];
      return next;
    });
    try {
      await navigator.clipboard.writeText(log.body);
      setCopiedIds((prev) => new Set(prev).add(log._id));
      if (copyTimers.current[log._id]) clearTimeout(copyTimers.current[log._id]);
      copyTimers.current[log._id] = setTimeout(() => {
        setCopiedIds((prev) => {
          const next = new Set(prev);
          next.delete(log._id);
          return next;
        });
        delete copyTimers.current[log._id];
      }, 2000);
    } catch {
      // navigator.clipboard can reject on insecure origins / permission denial
      setCopyErrors((prev) => ({ ...prev, [log._id]: "Copy failed — select the text and copy manually" }));
    }
  }

  async function handleMarkSent(log: OutreachLogItem) {
    if (markingRef.current.has(log._id)) return; // guard against double-submit
    markingRef.current.add(log._id);
    setMarkingIds(new Set(markingRef.current));
    setMarkErrors((prev) => {
      if (!(log._id in prev)) return prev;
      const next = { ...prev };
      delete next[log._id];
      return next;
    });

    const { error: err } = await apiFetch(`/api/outreach-logs/${log._id}/mark-sent`, { method: "POST" });

    markingRef.current.delete(log._id);
    setMarkingIds(new Set(markingRef.current));

    if (err) {
      setMarkErrors((prev) => ({ ...prev, [log._id]: err }));
      return;
    }
    // Optimistic removal — the log is now "sent" server-side
    setLogs((prev) => prev.filter((l) => l._id !== log._id));
    toastSuccess(
      `${log.contact?.businessName ?? "Contact"} marked as sent.`,
      "LOGGED"
    );
  }

  const errText: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: CLAY,
    display: "block",
    marginTop: 6,
  };

  return (
    <div className="page-enter" style={{ padding: "30px 42px 48px", minHeight: "100%" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <MonoLabel style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 8 }}>
            {logs.length} PENDING TASK{logs.length === 1 ? "" : "S"}
          </MonoLabel>
          <h1 style={{ fontFamily: serif, fontSize: 36, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.1 }}>
            Outreach Tasks
          </h1>
        </div>

      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            LOADING…
          </MonoLabel>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <Panel style={{ padding: "16px 22px", marginTop: 20 }}>
          <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>{error}</MonoLabel>
        </Panel>
      )}

      {/* Empty */}
      {!loading && !error && logs.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            NO PENDING OUTREACH TASKS
          </MonoLabel>
          <MonoLabel style={{ fontSize: 10.5, color: FAINT2, display: "block", marginTop: 8 }}>
            INSTAGRAM AND PHONE TOUCHES SHOW UP HERE ONCE THE SEQUENCE ENGINE DRAFTS THEM
          </MonoLabel>
        </div>
      )}

      {/* Task list — one Panel, dense hairline-divided rows, expand-on-click
          for the AI-drafted body (matches the /review approved-queue pattern). */}
      {!loading && !error && logs.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            {logs.map((log, idx) => {
              const { contact } = log;
              const contactLink = buildContactLink(log.channel, contact);
              const copied  = copiedIds.has(log._id);
              const marking = markingIds.has(log._id);
              const copyErr = copyErrors[log._id];
              const markErr = markErrors[log._id];
              const expanded = expandedId === log._id;

              return (
                <div key={log._id}>
                  {idx > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />}

                  {/* Collapsed row */}
                  <div
                    className="row-hover"
                    onClick={() => setExpandedId(expanded ? null : log._id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 20px",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "inline-flex", color: FAINT2, flexShrink: 0 }}>
                      {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontFamily: grotesk,
                            fontWeight: 600,
                            fontSize: 15,
                            color: INK,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {contact.businessName}
                        </span>
                        <ChannelBadge channel={log.channel} />
                        <MonoLabel style={{ fontSize: 10, letterSpacing: "0.06em" }}>
                          STAGE {log.stage}/3
                        </MonoLabel>
                        {contact.webPresenceTier && <TierBadge tier={contact.webPresenceTier} />}
                        {contact.claimed && <ClaimedBadge claimed={contact.claimed} />}
                      </div>
                    </div>

                    <PipelineMarker stage={contact.pipelineStage} />

                    {contactLink && (
                      <a
                        href={contactLink.href}
                        target={contactLink.external ? "_blank" : undefined}
                        rel={contactLink.external ? "noopener noreferrer" : undefined}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontFamily: mono,
                          fontSize: 10.5,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: INK,
                          border: "1px solid #C9BEA6",
                          borderRadius: 6,
                          padding: "5px 10px",
                          textDecoration: "none",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {contactLink.label}
                      </a>
                    )}

                    <Button
                      variant="primary"
                      disabled={marking}
                      onClick={(e) => { e.stopPropagation(); handleMarkSent(log); }}
                      style={{ padding: "6px 14px", fontSize: 12.5, flexShrink: 0 }}
                    >
                      {marking ? "Marking…" : "Mark sent"}
                    </Button>
                  </div>

                  {markErr && !expanded && (
                    <div style={{ padding: "0 20px 10px 47px" }}>
                      <span style={errText}>{markErr}</span>
                    </div>
                  )}

                  {/* Expanded: key points + AI-drafted body + copy */}
                  {expanded && (
                    <div style={{ padding: "0 20px 16px 47px", backgroundColor: "#F4F0E6" }}>
                      {contact.keyPoints && (
                        <div
                          style={{
                            marginBottom: 10,
                            padding: "9px 14px",
                            borderLeft: "2px solid #C68A1E",
                            backgroundColor: "#F6F1E2",
                          }}
                        >
                          <span style={{ fontFamily: mono, fontSize: 10, color: "#96712A", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            KEY POINTS →{" "}
                          </span>
                          <span style={{ fontFamily: mono, fontSize: 11, color: "#7A6E52" }}>
                            {contact.keyPoints}
                          </span>
                        </div>
                      )}

                      <div
                        style={{
                          fontFamily: grotesk,
                          fontSize: 14.5,
                          lineHeight: 1.65,
                          color: "#2A251C",
                          whiteSpace: "pre-wrap",
                          backgroundColor: "#FCFAF3",
                          border: "1px solid #E4DBC8",
                          borderRadius: 8,
                          padding: "12px 16px",
                        }}
                      >
                        {log.body}
                      </div>

                      {copyErr && <span style={errText}>{copyErr}</span>}
                      {markErr && <span style={errText}>{markErr}</span>}

                      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                        <Button
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); handleCopy(log); }}
                          style={{ padding: "7px 14px", fontSize: 13 }}
                        >
                          {copied ? "Copied" : "Copy message"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
        </div>
      )}
    </div>
  );
}

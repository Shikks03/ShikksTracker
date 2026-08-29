"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, Button, MonoLabel } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY } from "@/components/tokens";
import { ChannelBadge, TierBadge, ClaimedBadge } from "@/components/ChannelBadges";
import { apiFetch } from "@/lib/client";
import { toastSuccess } from "@/lib/toast";
import { normalizeHandleUrl, telHref, type Channel } from "@/lib/channels";

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors the GET /api/outreach-logs contract (Phase 4, built in parallel;
// defaults to both draft and approved logs — see resolveOutreachLogStatusFilter
// in src/lib/outreachLogs.ts). The board only ever shows non-email channels —
// email is fully automated and lives in the Review Queue instead.

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

interface OutreachLogItem {
  _id: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved" | "sent";
  channel: "facebook" | "instagram" | "phone";
  subject: string;
  body: string;
  createdAt?: string;
  contact: OutreachContact;
}

// ── Helpers ──────────────────────────────────────────────────────────────────────

/** Where the "contact" link on a task card should go, given the log's channel. */
function buildContactLink(
  channel: "facebook" | "instagram" | "phone",
  contact: OutreachContact
): { href: string; label: string; external: boolean } | null {
  if (channel === "phone") {
    if (!contact.phone) return null;
    return { href: telHref(contact.phone), label: contact.phone, external: false };
  }
  if (channel === "facebook") {
    if (!contact.facebook) return null;
    return { href: normalizeHandleUrl(contact.facebook, "facebook"), label: "Open Facebook →", external: true };
  }
  if (channel === "instagram") {
    if (!contact.instagram) return null;
    return { href: normalizeHandleUrl(contact.instagram, "instagram"), label: "Open Instagram →", external: true };
  }
  return null;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const [logs,    setLogs]    = useState<OutreachLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

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
    const { data, error: err } = await apiFetch<OutreachLogItem[]>("/api/outreach-logs");
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
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: CLAY,
    display: "block",
    marginTop: 10,
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px", minHeight: "100%" }}>

      {/* Header */}
      <MonoLabel style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 10 }}>
        {logs.length} PENDING TASK{logs.length === 1 ? "" : "S"}
      </MonoLabel>
      <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: "0 0 28px", lineHeight: 1.1 }}>
        Outreach Tasks
      </h1>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            LOADING…
          </MonoLabel>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <Panel style={{ padding: "22px 28px" }}>
          <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>{error}</MonoLabel>
        </Panel>
      )}

      {/* Empty */}
      {!loading && !error && logs.length === 0 && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            NO PENDING OUTREACH TASKS
          </MonoLabel>
          <MonoLabel style={{ fontSize: 10.5, color: FAINT2, display: "block", marginTop: 10 }}>
            FACEBOOK, INSTAGRAM AND PHONE TOUCHES SHOW UP HERE ONCE THE SEQUENCE ENGINE DRAFTS THEM
          </MonoLabel>
        </div>
      )}

      {/* Task list */}
      {!loading && !error && logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {logs.map((log) => {
            const { contact } = log;
            const contactLink = buildContactLink(log.channel, contact);
            const copied  = copiedIds.has(log._id);
            const marking = markingIds.has(log._id);
            const copyErr = copyErrors[log._id];
            const markErr = markErrors[log._id];

            return (
              <Panel key={log._id} style={{ padding: "24px 28px" }}>

                {/* Top row: business name + badges  ·  contact link */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: serif, fontSize: 22, color: INK, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
                      {contact.businessName}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                      <ChannelBadge channel={log.channel} />
                      <MonoLabel style={{ fontSize: 10.5, letterSpacing: "0.06em" }}>
                        STAGE {log.stage} OF 3
                      </MonoLabel>
                      {contact.webPresenceTier && <TierBadge tier={contact.webPresenceTier} />}
                      {contact.claimed && <ClaimedBadge claimed={contact.claimed} />}
                    </div>
                  </div>

                  {contactLink && (
                    <a
                      href={contactLink.href}
                      target={contactLink.external ? "_blank" : undefined}
                      rel={contactLink.external ? "noopener noreferrer" : undefined}
                      style={{
                        fontFamily: mono,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: INK,
                        border: "1px solid #C9BEA6",
                        borderRadius: 6,
                        padding: "7px 14px",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {contactLink.label}
                    </a>
                  )}
                </div>

                {/* Key points */}
                {contact.keyPoints && (
                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 18px",
                      borderLeft: "2px solid #C68A1E",
                      backgroundColor: "#F6F1E2",
                    }}
                  >
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: "#96712A", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      KEY POINTS →{" "}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 11.5, color: "#7A6E52" }}>
                      {contact.keyPoints}
                    </span>
                  </div>
                )}

                {/* AI-drafted message body */}
                <div
                  style={{
                    marginTop: 16,
                    fontFamily: grotesk,
                    fontSize: 15.5,
                    lineHeight: 1.7,
                    color: "#2A251C",
                    whiteSpace: "pre-wrap",
                    backgroundColor: "#FCFAF3",
                    border: "1px solid #E4DBC8",
                    borderRadius: 8,
                    padding: "16px 20px",
                  }}
                >
                  {log.body}
                </div>

                {copyErr && <span style={errText}>{copyErr}</span>}
                {markErr && <span style={errText}>{markErr}</span>}

                {/* Actions */}
                <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
                  <Button variant="outline" onClick={() => handleCopy(log)}>
                    {copied ? "Copied" : "Copy message"}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={marking}
                    onClick={() => handleMarkSent(log)}
                  >
                    {marking ? "Marking…" : "Mark sent"}
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

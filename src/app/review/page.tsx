"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import {
  Button,
  HotChip,
  MonoLabel,
  Panel,
  SectionHeader,
} from "@/components/ui";
import { useNextSendCountdown } from "@/components/useNextSendCountdown";
import {
  serif, grotesk, mono, INK, FAINT, FAINT2, CLAY, AMBER_TEXT,
  AMBER as AMBER_BORDER,
  FOREST_ACTION as FOREST,
} from "@/components/tokens";
import { apiFetch, HOT_THRESHOLD } from "@/lib/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailLogItem {
  _id: string;
  contactId: string;
  campaignId?: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved" | "sent";
  subject: string;
  body: string;
  /** Set when a send attempt failed; cleared on successful send. Present on approved logs that reverted after a Gmail error. */
  lastSendError?: string | null;
  sendErrorCount?: number;
}

interface ContactDoc {
  _id: string;
  businessName: string;
  contactName?: string;
  contactEmail: string;
  keyPoints?: string;
  engagementScore: number;
  campaignId?: string;
}

interface Campaign {
  _id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ordinalStage(stage: 1 | 2 | 3): string {
  if (stage === 1) return "1ST";
  if (stage === 2) return "2ND";
  return "3RD";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const countdown = useNextSendCountdown();

  const [drafts,      setDrafts]      = useState<EmailLogItem[]>([]);
  const [approved,    setApproved]    = useState<EmailLogItem[]>([]);
  const [contactMap,  setContactMap]  = useState<Record<string, ContactDoc>>({});
  const [campaignMap, setCampaignMap] = useState<Record<string, Campaign>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  // ── Send batch state ──────────────────────────────────────────────────────────
  // SEND_BATCH_MAX must match the server default in /api/send-batch/route.ts (envInt "SEND_BATCH_MAX", 5)
  const SEND_BATCH_MAX = 5;

  const [checkedIds,   setCheckedIds]   = useState<Set<string>>(new Set());
  const [sending,      setSending]      = useState(false);
  const [sendResults,  setSendResults]  = useState<
    { id: string; contactName: string; subject: string; status: "sent" | "failed" | "skipped"; error?: string }[]
  >([]);
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null);

  // Current draft index
  const [currentIdx, setCurrentIdx] = useState(0);

  // Edit mode
  const [editMode,    setEditMode]    = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody,    setEditBody]    = useState("");

  // Regenerate mode
  const [regenMode,      setRegenMode]      = useState(false);
  const [regenFeedback,  setRegenFeedback]  = useState("");
  const [regenLoading,   setRegenLoading]   = useState(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setGlobalError(null);

    const [draftRes, approvedRes, contactsRes, campaignsRes] = await Promise.all([
      apiFetch<EmailLogItem[]>("/api/email-logs?status=draft&channel=email"),
      apiFetch<EmailLogItem[]>("/api/email-logs?status=approved&channel=email"),
      apiFetch<ContactDoc[]>("/api/contacts"),
      apiFetch<Campaign[]>("/api/campaigns"),
    ]);

    if (draftRes.error)     setGlobalError(`Failed to load drafts: ${draftRes.error}`);
    if (approvedRes.error)  setGlobalError(`Failed to load approved: ${approvedRes.error}`);
    if (contactsRes.error)  setGlobalError(`Failed to load contacts: ${contactsRes.error}`);
    if (campaignsRes.error) setGlobalError(`Failed to load campaigns: ${campaignsRes.error}`);

    setDrafts(draftRes.data ?? []);
    setApproved(approvedRes.data ?? []);
    // Default all newly loaded approved logs to checked
    setCheckedIds(new Set((approvedRes.data ?? []).map((l) => l._id)));

    const cMap: Record<string, ContactDoc> = {};
    for (const c of contactsRes.data ?? []) cMap[c._id] = c;
    setContactMap(cMap);

    const campMap: Record<string, Campaign> = {};
    for (const c of campaignsRes.data ?? []) campMap[c._id] = c;
    setCampaignMap(campMap);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Clamp currentIdx when drafts list shrinks
  useEffect(() => {
    if (drafts.length > 0 && currentIdx >= drafts.length) {
      setCurrentIdx(drafts.length - 1);
    }
  }, [drafts.length, currentIdx]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleApprove(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    if (error) { setGlobalError(`Approve failed: ${error}`); return; }
    setEditMode(false);
    setRegenMode(false);
    setRegenFeedback("");
    // Advance index (clamp handled by effect after loadAll updates drafts)
    setCurrentIdx((idx) => Math.max(0, Math.min(idx, drafts.length - 2)));
    await loadAll();
  }

  async function handleSaveEdit(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ subject: editSubject, body: editBody }),
    });
    if (error) { setGlobalError(`Save failed: ${error}`); return; }
    setEditMode(false);
    await loadAll();
  }

  async function handleDiscard(id: string) {
    if (!window.confirm("Discard this draft?")) return;
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "DELETE",
    });
    if (error) { setGlobalError(`Discard failed: ${error}`); return; }
    setEditMode(false);
    setRegenMode(false);
    setRegenFeedback("");
    setCurrentIdx((idx) => Math.max(0, Math.min(idx, drafts.length - 2)));
    await loadAll();
  }

  async function handleRegenerate(id: string) {
    setRegenLoading(true);
    setGlobalError(null);
    const { error } = await apiFetch(`/api/email-logs/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ feedback: regenFeedback.trim() || undefined }),
    });
    setRegenLoading(false);
    if (error) {
      setGlobalError(`Regenerate failed: ${error}`);
      return;
    }
    setRegenMode(false);
    setRegenFeedback("");
    await loadAll();
  }

  async function handleUnapprove(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "draft" }),
    });
    if (error) { setGlobalError(`Unapprove failed: ${error}`); return; }
    await loadAll();
  }

  async function handleSendBatch() {
    if (checkedIds.size === 0) return;
    setSending(true);
    setSendResults([]);
    setSendProgress(null);
    setGlobalError(null);

    // Split selected ids into chunks of SEND_BATCH_MAX so each request stays
    // within the server's per-request cap and Vercel's function time limit.
    // A short randomised delay between chunks spreads sends over wall-clock time
    // (warm-up deliverability), without keeping a long-running server function open.
    const allIds = Array.from(checkedIds);
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += SEND_BATCH_MAX) {
      chunks.push(allIds.slice(i, i + SEND_BATCH_MAX));
    }

    // Inline delay helper — must NOT import from src/lib/gmail.ts (server dep)
    const clientDelay = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const accumulated: typeof sendResults = [];
    let capHit = false;

    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        setSendProgress({ done: ci, total: chunks.length });

        const res = await fetch("/api/send-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunks[ci] }),
        });

        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          setGlobalError(
            `Daily send cap reached (${(data as { cap?: number }).cap ?? 15}/day). ${accumulated.length > 0 ? "Earlier sends completed — see results below." : "No emails were sent."}`
          );
          capHit = true;
          break;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          // Surface the error but keep accumulated results from earlier chunks
          setGlobalError((data as { error?: string }).error ?? `HTTP ${res.status}`);
          break;
        }

        const data = (await res.json()) as {
          results: { id: string; contactName: string; subject: string; status: "sent" | "failed" | "skipped"; error?: string }[];
        };
        accumulated.push(...data.results);
        // Update results panel incrementally so user sees progress
        setSendResults([...accumulated]);

        // Short randomised inter-chunk delay (1500–4000 ms) — skip after last chunk
        if (ci < chunks.length - 1 && !capHit) {
          const delay = 1500 + Math.floor(Math.random() * 2500);
          await clientDelay(delay);
        }
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      setSendProgress(null);
      await loadAll();
    }
  }

  async function handleApproveAllSafe() {
    const safe = drafts.filter(
      (d) => (contactMap[d.contactId]?.engagementScore ?? 0) < HOT_THRESHOLD
    );
    setGlobalError(null);
    // Collect per-draft results — previously every error was ignored, so a
    // partial failure looked like full success (GAPS 4.2).
    let approved = 0;
    let failed = 0;
    for (const d of safe) {
      const { error } = await apiFetch(`/api/email-logs/${d._id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      });
      if (error) failed++;
      else approved++;
    }
    if (failed > 0) {
      setGlobalError(`Approved ${approved} of ${safe.length} — ${failed} failed.`);
    }
    setCurrentIdx(0);
    setEditMode(false);
    await loadAll();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  // Refs so the stable event listener always sees current state
  const draftsRef    = useRef(drafts);
  const currentIdxRef = useRef(currentIdx);
  const editModeRef  = useRef(editMode);

  draftsRef.current    = drafts;
  currentIdxRef.current = currentIdx;
  editModeRef.current  = editMode;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (editModeRef.current) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;

      const ds  = draftsRef.current;
      const idx = currentIdxRef.current;
      const cur = ds[idx];
      if (!cur) return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        apiFetch(`/api/email-logs/${cur._id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "approved" }),
        }).then(({ error }) => {
          if (error) setGlobalError(`Approve failed: ${error}`);
          else {
            setCurrentIdx(Math.max(0, Math.min(idx, ds.length - 2)));
            setEditMode(false);
            loadAll();
          }
        });
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        setEditSubject(cur.subject);
        setEditBody(cur.body);
        setEditMode(true);
        setRegenMode(false);
        setRegenFeedback("");
      } else if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (ds.length > 0) {
          setCurrentIdx((ds.length + idx + 1) % ds.length);
          setRegenMode(false);
          setRegenFeedback("");
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadAll]);

  // ── Derived values ────────────────────────────────────────────────────────────

  const currentDraft   = drafts[currentIdx] ?? null;
  const currentContact = currentDraft ? (contactMap[currentDraft.contactId] ?? null) : null;

  const campaignName = (() => {
    if (!currentDraft) return "";
    const campId = currentDraft.campaignId ?? currentContact?.campaignId ?? "";
    return campaignMap[campId]?.name ?? "";
  })();

  const isHot = (currentContact?.engagementScore ?? 0) >= HOT_THRESHOLD;

  // Up to 4 drafts after current
  const upNextDrafts = drafts.slice(currentIdx + 1, currentIdx + 5);

  const safeDraftCount = drafts.filter(
    (d) => (contactMap[d.contactId]?.engagementScore ?? 0) < HOT_THRESHOLD
  ).length;

  const upNextCount = Math.max(0, drafts.length - 1 - currentIdx);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px", minHeight: "100%" }}>

      {/* ── 1. HEADER ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        {/* Left: kicker + H1 */}
        <div>
          <MonoLabel
            style={{
              fontSize: 11,
              letterSpacing: "0.14em",
              color: FAINT,
              display: "block",
              marginBottom: 10,
            }}
          >
            {drafts.length > 0
              ? `DRAFT ${currentIdx + 1} / ${drafts.length} · SENDS IN ${countdown}`
              : `SENDS IN ${countdown}`}
          </MonoLabel>
          <h1
            style={{
              fontFamily: serif,
              fontSize: 40,
              fontWeight: 400,
              color: INK,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Review Queue
          </h1>
        </div>

        {/* Right: segmented progress bar */}
        {drafts.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              width: 160,
              marginTop: 18,
              flexShrink: 0,
              alignItems: "center",
            }}
          >
            {drafts.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: i <= currentIdx ? FOREST : "#D8CFBB",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Global error ── */}
      {globalError && (
        <Panel style={{ padding: "16px 22px", marginTop: 22 }}>
          <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>
            {globalError}
          </MonoLabel>
        </Panel>
      )}

      {/* ── 2. BODY ── */}
      {drafts.length === 0 ? (
        /* Empty state */
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <MonoLabel
            style={{
              fontSize: 12,
              letterSpacing: "0.14em",
              color: FAINT,
              display: "block",
            }}
          >
            NO DRAFTS PENDING
          </MonoLabel>
          <MonoLabel
            style={{
              fontSize: 10.5,
              color: FAINT2,
              display: "block",
              marginTop: 10,
            }}
          >
            THE SEQUENCE ENGINE GENERATES DRAFTS ON ITS NEXT RUN
          </MonoLabel>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 28,
            alignItems: "flex-start",
          }}
        >

          {/* ── CENTER FOCUS CARD ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ maxWidth: 620, margin: "0 auto" }}>

              <Panel
                style={{
                  padding: 0,
                  overflow: "hidden",
                  boxShadow: "0 8px 26px -16px rgba(40,30,10,.3)",
                }}
              >
                {/* Card header */}
                <div
                  style={{
                    padding: "22px 28px",
                    borderBottom: "1px solid #E4DBC8",
                  }}
                >
                  {/* Row 1: meta + chip(s) */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 16,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        color: FAINT2,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {(currentContact?.businessName ?? "—").toUpperCase()}
                      {" · "}
                      {ordinalStage(currentDraft.stage)} TOUCH
                      {campaignName ? ` · ${campaignName.toUpperCase()}` : ""}
                    </span>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexShrink: 0,
                      }}
                    >
                      {isHot && <HotChip />}
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10.5,
                          border: "1px solid #C9BEA6",
                          color: FAINT,
                          borderRadius: 4,
                          padding: "2px 8px",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        DRAFT
                      </span>
                    </div>
                  </div>

                  {/* Row 2: Subject */}
                  {editMode ? (
                    <input
                      value={editSubject}
                      onChange={(e) => setEditSubject(e.target.value)}
                      style={{
                        fontFamily: serif,
                        fontSize: 31,
                        fontWeight: 400,
                        color: INK,
                        letterSpacing: "-0.01em",
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid #C9BEA6",
                        outline: "none",
                        width: "100%",
                        marginTop: 10,
                        padding: "3px 0",
                        lineHeight: 1.2,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: serif,
                        fontSize: 31,
                        fontWeight: 400,
                        color: INK,
                        letterSpacing: "-0.01em",
                        marginTop: 10,
                        lineHeight: 1.2,
                      }}
                    >
                      {currentDraft.subject}
                    </div>
                  )}

                  {/* Row 3: TO */}
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 11,
                      color: FAINT2,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginTop: 8,
                    }}
                  >
                    TO — {currentContact?.contactEmail ?? "—"}
                  </div>
                </div>

                {/* Card body */}
                <div style={{ padding: "28px 28px 0" }}>
                  {editMode ? (
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      style={{
                        fontFamily: grotesk,
                        fontSize: 16.5,
                        lineHeight: 1.75,
                        color: "#2A251C",
                        background: "transparent",
                        border: "1px solid #C9BEA6",
                        borderRadius: 6,
                        outline: "none",
                        width: "100%",
                        minHeight: 260,
                        padding: "14px 18px",
                        resize: "vertical",
                        boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        fontFamily: grotesk,
                        fontSize: 16.5,
                        lineHeight: 1.75,
                        color: "#2A251C",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {currentDraft.body}
                    </div>
                  )}
                </div>

                {/* Key points strip */}
                {currentContact?.keyPoints && (
                  <div
                    style={{
                      margin: "16px 20px 18px",
                      padding: "14px 20px",
                      borderLeft: `2px solid ${AMBER_BORDER}`,
                      backgroundColor: "#F6F1E2",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        color: AMBER_TEXT,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      KEY POINTS →{" "}
                    </span>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 11.5,
                        color: "#7A6E52",
                      }}
                    >
                      {currentContact.keyPoints}
                    </span>
                  </div>
                )}

                {/* Spacer when no key points so footer isn't glued to body */}
                {!currentContact?.keyPoints && (
                  <div style={{ height: 18 }} />
                )}

                {/* Card footer */}
                <div
                  style={{
                    padding: "20px 28px",
                    borderTop: "1px solid #E4DBC8",
                    backgroundColor: "#F1EBDD",
                  }}
                >
                  {editMode ? (
                    <div style={{ display: "flex", gap: 14 }}>
                      <Button
                        variant="primary"
                        style={{ flex: 1 }}
                        onClick={() => handleSaveEdit(currentDraft._id)}
                      >
                        Save changes
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditMode(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : regenMode ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <input
                        autoFocus
                        placeholder="Optional: what should change? (e.g. 'too formal', 'mention our free trial')"
                        value={regenFeedback}
                        onChange={(e) => setRegenFeedback(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleRegenerate(currentDraft._id);
                          } else if (e.key === "Escape") {
                            setRegenMode(false);
                            setRegenFeedback("");
                          }
                        }}
                        style={{
                          fontFamily: mono,
                          fontSize: 12,
                          color: INK,
                          background: "#FDFAF2",
                          border: "1px solid #C9BEA6",
                          borderRadius: 6,
                          outline: "none",
                          width: "100%",
                          padding: "10px 14px",
                          boxSizing: "border-box",
                          letterSpacing: "0.02em",
                        }}
                      />
                      <div style={{ display: "flex", gap: 10 }}>
                        <Button
                          variant="primary"
                          style={{ flex: 1 }}
                          disabled={regenLoading}
                          onClick={() => handleRegenerate(currentDraft._id)}
                        >
                          {regenLoading ? "Regenerating…" : "Regenerate"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={regenLoading}
                          onClick={() => {
                            setRegenMode(false);
                            setRegenFeedback("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 14 }}>
                      <Button
                        variant="primary"
                        style={{ flex: 1 }}
                        onClick={() => handleApprove(currentDraft._id)}
                      >
                        <Check size={14} />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditSubject(currentDraft.subject);
                          setEditBody(currentDraft.body);
                          setEditMode(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setRegenMode(true);
                          setRegenFeedback("");
                        }}
                      >
                        Regenerate
                      </Button>
                      <Button
                        variant="danger-outline"
                        onClick={() => handleDiscard(currentDraft._id)}
                      >
                        Discard
                      </Button>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Keyboard hint */}
              {!editMode && !regenMode && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <span
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      color: FAINT,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                    }}
                  >
                    [A] APPROVE · [E] EDIT · [J] NEXT DRAFT
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── UP NEXT RAIL ── */}
          <div
            style={{
              width: 260,
              flexShrink: 0,
              padding: "20px 22px 28px",
              borderLeft: "1px solid #D8CFBB",
              backgroundColor: "#F4F0E6",
              borderRadius: "0 10px 10px 0",
            }}
          >
            <MonoLabel
              style={{
                fontSize: 11,
                letterSpacing: "0.14em",
                color: FAINT,
              }}
            >
              UP NEXT · {String(upNextCount).padStart(2, "0")}
            </MonoLabel>

            {/* Mini cards */}
            {upNextDrafts.map((d, i) => {
              const contact  = contactMap[d.contactId] ?? null;
              const hot      = (contact?.engagementScore ?? 0) >= HOT_THRESHOLD;
              const preview  = contact?.keyPoints
                ? contact.keyPoints.toUpperCase()
                : d.subject.toUpperCase();
              const actualIdx = currentIdx + 1 + i;

              return (
                <Panel
                  key={d._id}
                  className="row-hover"
                  style={{ padding: "14px 18px", marginTop: 14, cursor: "pointer" }}
                  onClick={() => {
                    setCurrentIdx(actualIdx);
                    setEditMode(false);
                    setRegenMode(false);
                    setRegenFeedback("");
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: grotesk,
                          fontWeight: 600,
                          fontSize: 14.5,
                          color: INK,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {contact?.businessName ?? "—"}
                      </span>
                      {hot && <HotChip />}
                    </div>
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 10,
                        border: "1px solid #C9BEA6",
                        color: FAINT2,
                        borderRadius: 3,
                        padding: "2px 6px",
                        textTransform: "uppercase",
                        flexShrink: 0,
                        marginLeft: 6,
                      }}
                    >
                      {ordinalStage(d.stage)}
                    </span>
                  </div>

                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: FAINT2,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      marginTop: 6,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {preview}
                  </div>
                </Panel>
              );
            })}

            {/* Approve all safe drafts */}
            <div style={{ marginTop: 18 }}>
              <Button
                variant="outline"
                style={{ width: "100%" }}
                disabled={safeDraftCount === 0}
                onClick={handleApproveAllSafe}
              >
                Approve all safe drafts
              </Button>
            </div>
          </div>

        </div>
      )}

      {/* ── 3. APPROVED · QUEUED STRIP ── */}
      {(approved.length > 0 || sendResults.length > 0) && (
        <div style={{ marginTop: 28 }}>
          <SectionHeader
            title="APPROVED · QUEUED FOR SEND"
            count={approved.length}
          />

          {/* Send results panel */}
          {sendResults.length > 0 && (
            <Panel style={{ padding: "16px 22px", marginTop: 14, overflow: "hidden" }}>
              {sendResults.map((r, i) => (
                <div key={r.id}>
                  {i > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8", margin: "8px 0" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: mono, fontSize: 13, color: r.status === "sent" ? FOREST : CLAY, flexShrink: 0 }}>
                      {r.status === "sent" ? "✓" : "✗"}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 11, color: "#5A5344", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.contactName.toUpperCase()} · {r.subject}
                    </span>
                    {r.error && (
                      <span style={{ fontFamily: mono, fontSize: 10.5, color: CLAY, flexShrink: 0 }}>
                        {r.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </Panel>
          )}

          {approved.length > 0 && (
            <>
              <Panel style={{ padding: 0, overflow: "hidden", marginTop: 14 }}>
                {approved.map((log, idx) => {
                  const contact = contactMap[log.contactId] ?? null;
                  const checked = checkedIds.has(log._id);
                  return (
                    <div key={log._id}>
                      {idx > 0 && (
                        <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />
                      )}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "14px 22px",
                        }}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(checkedIds);
                            if (e.target.checked) next.add(log._id);
                            else next.delete(log._id);
                            setCheckedIds(next);
                          }}
                          style={{ marginRight: 14, cursor: "pointer", flexShrink: 0, width: 15, height: 15, accentColor: FOREST }}
                        />

                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            marginRight: 16,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 11,
                              color: "#5A5344",
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "block",
                            }}
                          >
                            {(contact?.businessName ?? "—").toUpperCase()}
                            {" · "}
                            {ordinalStage(log.stage)} TOUCH
                            {" · "}
                            <span style={{ color: FAINT2 }}>{log.subject}</span>
                          </span>
                          {log.lastSendError && (
                            <span
                              style={{
                                fontFamily: mono,
                                fontSize: 10,
                                color: CLAY,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                                display: "block",
                                marginTop: 3,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={log.lastSendError}
                            >
                              SEND ERR ({log.sendErrorCount ?? 1}×) — {log.lastSendError}
                            </span>
                          )}
                        </div>
                        <UnapproveButton onUnapprove={() => handleUnapprove(log._id)} />
                      </div>
                    </div>
                  );
                })}
              </Panel>

              {/* Send button + progress */}
              {checkedIds.size > 0 && (
                <div style={{ marginTop: 14 }}>
                  <Button
                    variant="primary"
                    style={{ width: "100%" }}
                    disabled={sending}
                    onClick={handleSendBatch}
                  >
                    {sending && sendProgress
                      ? `Sending… batch ${sendProgress.done + 1}/${sendProgress.total}`
                      : sending
                      ? "Sending…"
                      : `Send ${checkedIds.size} email${checkedIds.size === 1 ? "" : "s"}`}
                  </Button>
                  {sending && sendProgress && sendProgress.total > 1 && (
                    <div style={{ marginTop: 8, textAlign: "center" }}>
                      <span
                        style={{
                          fontFamily: mono,
                          fontSize: 10.5,
                          color: FAINT,
                          textTransform: "uppercase",
                          letterSpacing: "0.1em",
                        }}
                      >
                        {sendProgress.done} OF {sendProgress.total} BATCHES SENT · SPACING NEXT
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UnapproveButton({ onUnapprove }: { onUnapprove: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onUnapprove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: mono,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: FAINT,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
        textDecoration: hovered ? "underline" : "none",
      }}
    >
      Unapprove
    </button>
  );
}

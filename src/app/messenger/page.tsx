"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Panel, Button, MonoLabel, PipelineMarker } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY, FOREST_ACTION as FOREST } from "@/components/tokens";
import { apiFetch } from "@/lib/client";
import { toastSuccess, toastInfo } from "@/lib/toast";

// ── Types ─────────────────────────────────────────────────────────────────────
// Mirrors GET/PATCH /api/messenger/conversations[,/[id]] exactly — see those
// route files for the authoritative shape. Facebook is the only channel this
// lane handles (spec §B); instagram + phone stay on /outreach.

interface LinkSuggestion {
  contactId: string;
  businessName: string;
  score: number;
}

interface ConversationContact {
  _id: string;
  businessName: string;
  contactName: string | null;
  pipelineStage: string;
  currentStage: number;
}

interface ConversationItem {
  _id: string;
  psid: string;
  displayName: string;
  linkStatus: "unlinked" | "linked" | "ignored";
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  unanswered: boolean;
  contact: ConversationContact | null;
  suggestions: LinkSuggestion[];
  lastMessageText: string;
}

interface ThreadMessage {
  _id: string;
  mid: string;
  direction: "in" | "out";
  text: string;
  sentAt: string | null;
}

interface ThreadContact {
  _id: string;
  businessName: string;
  contactName: string | null;
  pipelineStage: string;
  currentStage: number;
  outreachChannel: string;
}

interface DraftLogItem {
  _id: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved";
  body: string;
  createdAt: string | null;
}

interface ThreadResponse {
  conversation: {
    _id: string;
    psid: string;
    displayName: string;
    linkStatus: "unlinked" | "linked" | "ignored";
    contactId: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    createdAt: string | null;
  };
  messages: ThreadMessage[];
  contact: ThreadContact | null;
  draftLogs: DraftLogItem[];
}

interface ContactOption {
  _id: string;
  businessName: string;
  contactName?: string;
  outreachChannel?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtShortDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** As a Page admin, this opens the live Messenger thread for a PSID directly —
 *  the actual next action once a drafted reply is copied, and more useful
 *  here than a generic profile link since we may not even have one on file. */
function messengerThreadUrl(psid: string): string {
  return `https://www.facebook.com/messages/t/${encodeURIComponent(psid)}`;
}

function ordinalStage(stage: 1 | 2 | 3): string {
  if (stage === 1) return "1ST";
  if (stage === 2) return "2ND";
  return "3RD";
}

const MAX_SEARCH_RESULTS = 6;
const MAX_SUGGESTION_CHIPS = 3;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MessengerPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const [linkingIds, setLinkingIds] = useState<Set<string>>(new Set());
  const [ignoringIds, setIgnoringIds] = useState<Set<string>>(new Set());
  const [unlinking, setUnlinking] = useState(false);

  // Free contact search, per unlinked row. Contacts are loaded once, lazily,
  // on first use — this is a single-user tool with a small contact list, so
  // one unfiltered fetch beats adding a server-side search endpoint for it.
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [allContacts, setAllContacts] = useState<ContactOption[] | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);

  // Draft-lane copy/mark-sent state — lifted from /outreach's row.
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());
  const [copyErrors, setCopyErrors] = useState<Record<string, string>>({});
  const copyTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const markingRef = useRef<Set<string>>(new Set());
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [markErrors, setMarkErrors] = useState<Record<string, string>>({});

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    setConvLoading(true);
    setConvError(null);
    const { data, error: err } = await apiFetch<ConversationItem[]>(
      "/api/messenger/conversations"
    );
    setConvLoading(false);
    if (err) { setConvError(err); return; }
    setConversations(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    const { data, error: err } = await apiFetch<ThreadResponse>(
      `/api/messenger/conversations/${id}`
    );
    setThreadLoading(false);
    if (err) { setThread(null); return; }
    setThread(data);
  }, []);

  useEffect(() => {
    if (selectedId) loadThread(selectedId);
    else setThread(null);
  }, [selectedId, loadThread]);

  // Clean up copy-feedback timers on unmount.
  useEffect(() => {
    const timers = copyTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  async function ensureContactsLoaded() {
    if (allContacts !== null || contactsLoading) return;
    setContactsLoading(true);
    const { data } = await apiFetch<ContactOption[]>("/api/contacts", undefined, { silent: true });
    setContactsLoading(false);
    setAllContacts(data ?? []);
  }

  // ── Linking actions ──────────────────────────────────────────────────────────

  async function handleLink(conversationId: string, contactId: string, businessName: string) {
    if (linkingIds.has(conversationId)) return;
    setLinkingIds((prev) => new Set(prev).add(conversationId));

    const { data, error: err } = await apiFetch<{ effectsApplied: boolean }>(
      `/api/messenger/conversations/${conversationId}`,
      { method: "PATCH", body: JSON.stringify({ action: "link", contactId }) }
    );

    setLinkingIds((prev) => { const next = new Set(prev); next.delete(conversationId); return next; });
    if (err) return;

    toastSuccess(
      `Linked to ${businessName}.${data?.effectsApplied ? " Reply effects applied — contact marked replied." : ""}`,
      "LINKED"
    );
    setSearchQueries((prev) => { const next = { ...prev }; delete next[conversationId]; return next; });
    await loadConversations();
    if (selectedId === conversationId) await loadThread(conversationId);
  }

  async function handleIgnore(conversationId: string) {
    if (ignoringIds.has(conversationId)) return;
    setIgnoringIds((prev) => new Set(prev).add(conversationId));

    const { error: err } = await apiFetch(`/api/messenger/conversations/${conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "ignore" }),
    });

    setIgnoringIds((prev) => { const next = new Set(prev); next.delete(conversationId); return next; });
    if (err) return;

    toastSuccess("Conversation ignored.", "IGNORED");
    if (selectedId === conversationId) setSelectedId(null);
    await loadConversations();
  }

  async function handleUnlink() {
    if (!thread || unlinking) return;
    const ok = window.confirm(
      "Unlink this conversation? This does NOT reverse reply effects already applied " +
      "(engagement score, status/pipeline stage, cleared follow-ups all stand)."
    );
    if (!ok) return;

    setUnlinking(true);
    const { data, error: err } = await apiFetch<{ note?: string }>(
      `/api/messenger/conversations/${thread.conversation._id}`,
      { method: "PATCH", body: JSON.stringify({ action: "unlink" }) }
    );
    setUnlinking(false);
    if (err) return;

    toastInfo(data?.note ?? "Conversation unlinked.", "UNLINKED");
    await loadConversations();
    await loadThread(thread.conversation._id);
  }

  // ── Draft lane actions (lifted from /outreach) ───────────────────────────────

  async function handleCopy(log: DraftLogItem) {
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
      setCopyErrors((prev) => ({ ...prev, [log._id]: "Copy failed — select the text and copy manually" }));
    }
  }

  async function handleMarkSent(log: DraftLogItem) {
    if (markingRef.current.has(log._id)) return;
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
    setThread((prev) => prev ? { ...prev, draftLogs: prev.draftLogs.filter((l) => l._id !== log._id) } : prev);
    toastSuccess(`${thread?.contact?.businessName ?? "Contact"} marked as sent.`, "LOGGED");
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

  const paneMaxHeight = "min(70vh, 700px)";
  const unansweredCount = conversations.filter((c) => c.unanswered).length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page-enter" style={{ padding: "30px 42px 48px", minHeight: "100%" }}>

      {/* Header */}
      <div>
        <MonoLabel style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 8 }}>
          {conversations.length} CONVERSATION{conversations.length === 1 ? "" : "S"}
          {unansweredCount > 0 ? ` · ${unansweredCount} UNANSWERED` : ""}
        </MonoLabel>
        <h1 style={{ fontFamily: serif, fontSize: 36, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: 0, lineHeight: 1.1 }}>
          Messenger
        </h1>
      </div>

      {/* Loading */}
      {convLoading && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            LOADING…
          </MonoLabel>
        </div>
      )}

      {/* Error */}
      {!convLoading && convError && (
        <Panel style={{ padding: "16px 22px", marginTop: 20 }}>
          <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>{convError}</MonoLabel>
        </Panel>
      )}

      {/* Empty state — the likely first-run view: no Meta webhook connected yet. */}
      {!convLoading && !convError && conversations.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <MonoLabel style={{ fontSize: 12, letterSpacing: "0.14em", color: FAINT, display: "block" }}>
            NO CONVERSATIONS YET
          </MonoLabel>
          <MonoLabel style={{ fontSize: 10.5, color: FAINT2, display: "block", marginTop: 8, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
            INBOUND FACEBOOK MESSAGES APPEAR HERE ONCE THE META WEBHOOK IS RECEIVING TRAFFIC — SEE DOCS/META-SETUP.MD
          </MonoLabel>
        </div>
      )}

      {/* Three-pane layout */}
      {!convLoading && !convError && conversations.length > 0 && (
        <div style={{ display: "flex", gap: 22, marginTop: 22, alignItems: "flex-start" }}>

          {/* ── 1. CONVERSATIONS LIST ── */}
          <div style={{ width: 320, flexShrink: 0 }}>
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ maxHeight: paneMaxHeight, overflowY: "auto" }}>
                {conversations.map((conv, idx) => {
                  const isSelected = selectedId === conv._id;
                  const isUnlinked = conv.linkStatus === "unlinked";
                  const title = conv.contact?.businessName ?? conv.displayName ?? "(unknown)";
                  const linking = linkingIds.has(conv._id);
                  const ignoring = ignoringIds.has(conv._id);
                  const query = searchQueries[conv._id] ?? "";
                  const matches = query.trim().length > 0 && allContacts
                    ? allContacts
                        .filter((c) => c.outreachChannel === "facebook")
                        .filter((c) => {
                          const q = query.trim().toLowerCase();
                          return (
                            c.businessName.toLowerCase().includes(q) ||
                            (c.contactName ?? "").toLowerCase().includes(q)
                          );
                        })
                        .slice(0, MAX_SEARCH_RESULTS)
                    : [];

                  return (
                    <div key={conv._id}>
                      {idx > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />}

                      <div
                        className={isSelected ? "" : "row-hover"}
                        onClick={() => setSelectedId(conv._id)}
                        style={{
                          padding: "10px 16px",
                          cursor: "pointer",
                          borderLeft: `3px solid ${isSelected ? FOREST : "transparent"}`,
                          backgroundColor: isSelected ? "#FDFBF3" : "transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {conv.unanswered && (
                            <span
                              title="Unanswered"
                              style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: CLAY, flexShrink: 0 }}
                            />
                          )}
                          <span
                            style={{
                              fontFamily: grotesk,
                              fontWeight: 600,
                              fontSize: 14,
                              color: INK,
                              flex: 1,
                              minWidth: 0,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {title}
                          </span>
                          <MonoLabel style={{ fontSize: 9.5, flexShrink: 0 }}>
                            {fmtShortDate(conv.lastInboundAt)}
                          </MonoLabel>
                        </div>

                        {conv.lastMessageText && (
                          <div
                            style={{
                              fontFamily: mono,
                              fontSize: 10.5,
                              color: FAINT2,
                              marginTop: 3,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {conv.lastMessageText}
                          </div>
                        )}

                        {/* Unlinked extras: suggestion chips, free search, ignore. */}
                        {isUnlinked && (
                          <div
                            style={{ marginTop: 8 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {conv.suggestions.length > 0 && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                                {conv.suggestions.slice(0, MAX_SUGGESTION_CHIPS).map((s) => (
                                  <button
                                    key={s.contactId}
                                    disabled={linking}
                                    onClick={() => handleLink(conv._id, s.contactId, s.businessName)}
                                    style={{
                                      fontFamily: mono,
                                      fontSize: 10,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.04em",
                                      color: INK,
                                      background: "#F1EBDD",
                                      border: "1px solid #C9BEA6",
                                      borderRadius: 4,
                                      padding: "3px 8px",
                                      cursor: linking ? "default" : "pointer",
                                      opacity: linking ? 0.6 : 1,
                                    }}
                                  >
                                    {linking ? "Linking…" : `Link → ${s.businessName}`}
                                  </button>
                                ))}
                              </div>
                            )}

                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <input
                                value={query}
                                onFocus={ensureContactsLoaded}
                                onChange={(e) =>
                                  setSearchQueries((prev) => ({ ...prev, [conv._id]: e.target.value }))
                                }
                                placeholder="Search contacts…"
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  fontFamily: mono,
                                  fontSize: 10.5,
                                  color: INK,
                                  background: "#FCFAF3",
                                  border: "1px solid #D3C9B4",
                                  borderRadius: 5,
                                  padding: "4px 8px",
                                  outline: "none",
                                }}
                              />
                              <TextButton
                                label={ignoring ? "Ignoring…" : "Ignore"}
                                disabled={ignoring}
                                onClick={() => handleIgnore(conv._id)}
                              />
                            </div>

                            {contactsLoading && query.trim().length > 0 && (
                              <MonoLabel style={{ fontSize: 9.5, display: "block", marginTop: 4 }}>
                                LOADING CONTACTS…
                              </MonoLabel>
                            )}

                            {matches.length > 0 && (
                              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                                {matches.map((c) => (
                                  <button
                                    key={c._id}
                                    disabled={linking}
                                    onClick={() => handleLink(conv._id, c._id, c.businessName)}
                                    style={{
                                      textAlign: "left",
                                      fontFamily: mono,
                                      fontSize: 10.5,
                                      color: INK,
                                      background: "transparent",
                                      border: "1px solid #D3C9B4",
                                      borderRadius: 4,
                                      padding: "4px 8px",
                                      cursor: linking ? "default" : "pointer",
                                    }}
                                  >
                                    {c.businessName}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

          {/* ── 2. THREAD VIEW ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              {!selectedId && (
                <div style={{ padding: "60px 0", textAlign: "center" }}>
                  <MonoLabel style={{ fontSize: 11.5, letterSpacing: "0.12em", color: FAINT }}>
                    SELECT A CONVERSATION
                  </MonoLabel>
                </div>
              )}

              {selectedId && threadLoading && (
                <div style={{ padding: "60px 0", textAlign: "center" }}>
                  <MonoLabel style={{ fontSize: 11.5, letterSpacing: "0.12em", color: FAINT }}>
                    LOADING…
                  </MonoLabel>
                </div>
              )}

              {selectedId && !threadLoading && thread && (
                <>
                  {/* Thread header */}
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid #E4DBC8", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: grotesk, fontWeight: 600, fontSize: 16, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {thread.contact?.businessName ?? thread.conversation.displayName ?? "(unknown)"}
                      </div>
                      {thread.contact ? (
                        <div style={{ marginTop: 4 }}>
                          <PipelineMarker stage={thread.contact.pipelineStage} />
                        </div>
                      ) : (
                        <MonoLabel style={{ fontSize: 10, display: "block", marginTop: 4 }}>
                          UNLINKED — LINK A CONTACT FROM THE LIST TO SEE PIPELINE STATE
                        </MonoLabel>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <a
                        href={messengerThreadUrl(thread.conversation.psid)}
                        target="_blank"
                        rel="noopener noreferrer"
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
                        }}
                      >
                        Open Messenger →
                      </a>
                      {thread.contact && (
                        <Link
                          href={`/contacts/${thread.contact._id}`}
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
                          }}
                        >
                          Open contact →
                        </Link>
                      )}
                      {thread.contact && (
                        <TextButton label={unlinking ? "Unlinking…" : "Unlink"} disabled={unlinking} onClick={handleUnlink} />
                      )}
                    </div>
                  </div>

                  {/* Messages, chronological */}
                  <div style={{ maxHeight: paneMaxHeight, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {thread.messages.length === 0 && (
                      <MonoLabel style={{ fontSize: 10.5, color: FAINT2, textAlign: "center", padding: "20px 0" }}>
                        NO MESSAGES STORED FOR THIS CONVERSATION
                      </MonoLabel>
                    )}
                    {thread.messages.map((m) => {
                      const out = m.direction === "out";
                      return (
                        <div key={m._id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
                          <div style={{ maxWidth: "76%" }}>
                            <div
                              style={{
                                fontFamily: grotesk,
                                fontSize: 14,
                                lineHeight: 1.5,
                                color: out ? "#F4EEDF" : "#2A251C",
                                backgroundColor: out ? FOREST : "#F1EBDD",
                                border: out ? "none" : "1px solid #E4DBC8",
                                borderRadius: 10,
                                padding: "8px 13px",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {m.text || "[attachment]"}
                            </div>
                            <div
                              style={{
                                fontFamily: mono,
                                fontSize: 9.5,
                                color: FAINT2,
                                marginTop: 3,
                                textAlign: out ? "right" : "left",
                              }}
                            >
                              {fmtDateTime(m.sentAt)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </Panel>
          </div>

          {/* ── 3. DRAFT LANE ── */}
          <div style={{ width: 280, flexShrink: 0 }}>
            <Panel style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #E4DBC8" }}>
                <MonoLabel style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>
                  PENDING DRAFTS{thread ? ` · ${thread.draftLogs.length}` : ""}
                </MonoLabel>
              </div>

              <div style={{ maxHeight: paneMaxHeight, overflowY: "auto" }}>
                {!thread && (
                  <div style={{ padding: "24px 16px", textAlign: "center" }}>
                    <MonoLabel style={{ fontSize: 10, color: FAINT2 }}>
                      SELECT A CONVERSATION
                    </MonoLabel>
                  </div>
                )}

                {thread && !thread.contact && (
                  <div style={{ padding: "24px 16px", textAlign: "center" }}>
                    <MonoLabel style={{ fontSize: 10, color: FAINT2 }}>
                      LINK A CONTACT TO SEE PENDING DRAFTS
                    </MonoLabel>
                  </div>
                )}

                {thread && thread.contact && thread.draftLogs.length === 0 && (
                  <div style={{ padding: "24px 16px", textAlign: "center" }}>
                    <MonoLabel style={{ fontSize: 10, color: FAINT2 }}>
                      NO PENDING DRAFTS
                    </MonoLabel>
                  </div>
                )}

                {thread && thread.contact && thread.draftLogs.map((log, idx) => {
                  const copied = copiedIds.has(log._id);
                  const marking = markingIds.has(log._id);
                  const copyErr = copyErrors[log._id];
                  const markErr = markErrors[log._id];

                  return (
                    <div key={log._id}>
                      {idx > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />}
                      <div style={{ padding: "12px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <MonoLabel style={{ fontSize: 10 }}>STAGE {log.stage}/3</MonoLabel>
                          <span
                            style={{
                              fontFamily: mono,
                              fontSize: 9.5,
                              border: "1px solid #C9BEA6",
                              color: FAINT2,
                              borderRadius: 3,
                              padding: "1px 6px",
                              textTransform: "uppercase",
                            }}
                          >
                            {log.status}
                          </span>
                        </div>

                        <div
                          style={{
                            fontFamily: grotesk,
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: "#2A251C",
                            whiteSpace: "pre-wrap",
                            marginTop: 8,
                          }}
                        >
                          {log.body}
                        </div>

                        {copyErr && <span style={errText}>{copyErr}</span>}
                        {markErr && <span style={errText}>{markErr}</span>}

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          <Button
                            variant="outline"
                            onClick={() => handleCopy(log)}
                            style={{ padding: "5px 10px", fontSize: 11.5 }}
                          >
                            {copied ? "Copied" : "Copy"}
                          </Button>
                          <a
                            href={messengerThreadUrl(thread.conversation.psid)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontFamily: mono,
                              fontSize: 10.5,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              color: INK,
                              border: "1px solid #C9BEA6",
                              borderRadius: 6,
                              padding: "5px 10px",
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            Open →
                          </a>
                          <Button
                            variant="primary"
                            disabled={marking}
                            onClick={() => handleMarkSent(log)}
                            style={{ padding: "5px 10px", fontSize: 11.5 }}
                          >
                            {marking ? "Marking…" : "Mark sent"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TextButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: mono,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: disabled ? FAINT2 : FAINT,
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        padding: 0,
        flexShrink: 0,
        whiteSpace: "nowrap",
        textDecoration: hovered && !disabled ? "underline" : "none",
      }}
    >
      {label}
    </button>
  );
}

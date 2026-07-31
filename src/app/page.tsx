"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import {
  MonoLabel,
  Panel,
  InitialsTile,
  HotChip,
  PIPELINE_META,
  PipelineMarker,
  SectionHeader,
  monoInputClass,
  panelShadow,
} from "@/components/ui";
import { useNextSendCountdown } from "@/components/useNextSendCountdown";
import {
  serif, grotesk, mono, INK, FAINT, FAINT2, CLAY,
  AMBER, AMBER_TEXT, HOT_TEXT, GREEN_SENT, HOT_BG,
} from "@/components/tokens";
import { displayIdentity } from "@/lib/channels";
import { apiFetch, HOT_THRESHOLD } from "@/lib/client";

// Send window hours (Manila) — must match sequence.ts
const SEND_WINDOW_START = 8;
const SEND_WINDOW_END   = 18;
/** Pinger is considered stale when the last run is older than this (ms). */
const STALE_PINGER_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Types ────────────────────────────────────────────────────────────────────

interface Campaign {
  _id: string;
  name: string;
}

interface CronRunDoc {
  _id: string;
  startedAt: string;
  durationMs: number;
  errorCount: number;
  summary: {
    sent: number;
    errors: string[];
  };
}

interface ContactRow {
  _id: string;
  businessName: string;
  // Multi-channel outreach (Phase 4): scraped Facebook/Instagram/phone-only
  // leads have neither a name nor an email — both are optional. See
  // displayIdentity() in src/lib/channels.ts for the render-time fallback.
  contactEmail?: string;
  contactName?: string;
  outreachChannel?: string;
  phone?: string;
  facebook?: string;
  instagram?: string;
  leadSource: string;
  pipelineStage: string;
  status: string;
  engagementScore: number;
  lastSentAt?: string | null;
  opened?: boolean;
  clicked?: boolean;
  replied?: boolean;
  repliedAt?: string | null;
  replySnippet?: string | null;
  lastLogStage?: 1 | 2 | 3 | null;
  lastLogStatus?: "draft" | "approved" | "sent" | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
}

type RowGroup = "replied" | "in_sequence" | "closed";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (hours < 24) return `${hours}H AGO`;
  return `${days}D AGO`;
}

function ordinal(n: number | null | undefined): string {
  if (!n || n === 1) return "1ST";
  if (n === 2) return "2ND";
  if (n === 3) return "3RD";
  return `${n}TH`;
}

function shortDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

function getManilaGreeting(): string {
  const manilaHour = (new Date().getUTCHours() + 8) % 24;
  if (manilaHour < 12) return "umaga";
  if (manilaHour < 18) return "hapon";
  return "gabi";
}

function getManilaHour(): number {
  return (new Date().getUTCHours() + 8) % 24;
}

/**
 * Returns the UTC ms for Manila midnight of the given date (Manila = UTC+8, no DST).
 * Mirrors getManilaDayStart from sequence.ts for client-side use.
 */
function getManilaDayStartMs(date: Date): number {
  const manilaOffsetMs = 8 * 60 * 60 * 1000;
  const manilaMs = date.getTime() + manilaOffsetMs;
  const dayStartMs = Math.floor(manilaMs / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
  return dayStartMs - manilaOffsetMs;
}

/**
 * Returns a chip label for a nextActionAt date relative to Manila today, or null.
 *  - Past Manila day  → "OVERDUE {n}D"
 *  - Same Manila day  → "DUE TODAY"
 *  - Future / null    → null (no chip)
 */
function nextActionChipLabel(nextActionAt: string | null | undefined): string | null {
  if (!nextActionAt) return null;
  const actionMs = new Date(nextActionAt).getTime();
  const now = new Date();
  if (isNaN(actionMs)) return null;
  const nowDayStartMs    = getManilaDayStartMs(now);
  const actionDayStartMs = getManilaDayStartMs(new Date(actionMs));
  if (actionDayStartMs > nowDayStartMs) return null; // future
  if (actionDayStartMs === nowDayStartMs) return "DUE TODAY";
  const daysOver = Math.floor((nowDayStartMs - actionDayStartMs) / (24 * 60 * 60 * 1000));
  return `OVERDUE ${daysOver}D`;
}

function isWithinSendWindow(): boolean {
  const h = getManilaHour();
  return h >= SEND_WINDOW_START && h < SEND_WINDOW_END;
}

function timeAgoShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getKickerDate(): string {
  const now = new Date();
  const DAY = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${DAY[now.getDay()]} · ${MON[now.getMonth()]} ${now.getDate()}`;
}


// Row meta builders
function repliedMeta(c: ContactRow): string {
  const name = displayIdentity(c).toUpperCase();
  const parts: string[] = [name];
  if (c.repliedAt) parts.push(`REPLIED ${timeAgo(c.repliedAt)}`);
  if (c.replySnippet) parts.push(`"${c.replySnippet}"`);
  return parts.join(" · ");
}

function inSequenceMeta(c: ContactRow): string {
  const name = displayIdentity(c).toUpperCase();
  const ord  = ordinal(c.lastLogStage);
  if (!c.lastLogStage) return `${name} · QUEUED`;
  if (c.lastLogStatus === "draft" || c.lastLogStatus === "approved") {
    return `${name} · ${ord} TOUCH DRAFT READY`;
  }
  if (c.lastLogStatus === "sent" && c.lastSentAt) {
    return `${name} · ${ord} TOUCH SENT ${shortDate(c.lastSentAt)}`;
  }
  return `${name} · QUEUED`;
}

function closedMeta(c: ContactRow): string {
  const name  = displayIdentity(c).toUpperCase();
  const stage = c.pipelineStage === "won" ? "WON" : "LOST";
  return `${name} · ${stage}`;
}

// ── Row component (module-level so React reconciles by type, not position) ────

function ContactRowItem({
  c,
  group,
  onNavigate,
}: {
  c: ContactRow;
  group: RowGroup;
  onNavigate: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isHot  = (c.engagementScore ?? 0) >= HOT_THRESHOLD;
  const ord    = ordinal(c.lastLogStage);
  const score  = c.engagementScore ?? 0;
  const actionChip = group === "replied" ? nextActionChipLabel(c.nextActionAt) : null;

  let meta = "";
  if (group === "replied")      meta = repliedMeta(c);
  else if (group === "in_sequence") meta = inSequenceMeta(c);
  else                          meta = closedMeta(c);

  const rowBg = isHot ? HOT_BG : (hovered ? "#FBF8F0" : "transparent");

  return (
    <div
      className={isHot ? undefined : "row-hover"}
      onClick={() => onNavigate(c._id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "18px 22px",
        cursor: "pointer",
        backgroundColor: rowBg,
        boxShadow: isHot ? "inset 4px 0 0 #C68A1E" : undefined,
        transition: "background-color 0.1s",
      }}
    >
      {/* Initials tile */}
      <InitialsTile name={c.businessName} />

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontFamily: grotesk,
              fontWeight: 600,
              fontSize: 16,
              color: INK,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.businessName}
          </span>
          {isHot && <HotChip />}
          {c.status !== "active" && c.status !== "replied" && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                border: `1px solid ${c.status === "bounced" || c.status === "unsubscribed" ? CLAY : FAINT}`,
                color: c.status === "bounced" || c.status === "unsubscribed" ? CLAY : FAINT,
                backgroundColor: c.status === "bounced" || c.status === "unsubscribed" ? "#FDF3EF" : "transparent",
                borderRadius: 4,
                padding: "2px 8px",
                lineHeight: 1.6,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {c.status.toUpperCase()}
            </span>
          )}
          {actionChip && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                border: `1px solid ${actionChip.startsWith("OVERDUE") ? CLAY : AMBER}`,
                color: actionChip.startsWith("OVERDUE") ? CLAY : AMBER_TEXT,
                backgroundColor: actionChip.startsWith("OVERDUE") ? "#FDF3EF" : "#FEF5E4",
                borderRadius: 4,
                padding: "2px 8px",
                lineHeight: 1.6,
                flexShrink: 0,
                whiteSpace: "nowrap",
              }}
            >
              {actionChip}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: FAINT2,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginTop: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {meta}
        </div>
      </div>

      {/* Right cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
        <PipelineMarker stage={c.pipelineStage} />

        {group === "in_sequence" && c.lastLogStage != null && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: c.lastLogStatus === "sent" ? GREEN_SENT : FAINT2,
              whiteSpace: "nowrap",
            }}
          >
            {c.lastLogStatus === "sent" ? "SENT" : "DRAFT"} · {ord}
          </span>
        )}

        <span
          style={{
            fontFamily: mono,
            fontSize: 17,
            fontWeight: 700,
            width: 26,
            textAlign: "right",
            color: isHot ? HOT_TEXT : "#5A5344",
            flexShrink: 0,
          }}
        >
          {score}
        </span>
      </div>
    </div>
  );
}

function GroupPanel({
  rows,
  group,
  onNavigate,
}: {
  rows: ContactRow[];
  group: RowGroup;
  onNavigate: (id: string) => void;
}) {
  return (
    <Panel style={{ padding: 0, overflow: "hidden" }}>
      {rows.map((c, idx) => (
        <div key={c._id}>
          {idx > 0 && (
            <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />
          )}
          <ContactRowItem c={c} group={group} onNavigate={onNavigate} />
        </div>
      ))}
    </Panel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router    = useRouter();
  const countdown = useNextSendCountdown();
  const repliedRef = useRef<HTMLDivElement>(null);

  const [campaigns,     setCampaigns]     = useState<Campaign[]>([]);
  const [contacts,      setContacts]      = useState<ContactRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [draftCount,    setDraftCount]    = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [configError,   setConfigError]   = useState<string | null>(null); // campaigns/draft-count/cron-run load failures (previously swallowed)
  const [lastCronRun,   setLastCronRun]   = useState<CronRunDoc | null | "none">(null); // null=loading, "none"=no runs yet

  // Filter state
  const [search,        setSearch]        = useState("");
  const [campaignId,    setCampaignId]    = useState("");
  const [pipelineStage, setPipelineStage] = useState("");
  const [leadSource,    setLeadSource]    = useState("");
  const [hotOnly,       setHotOnly]       = useState(false);
  const [sortByScore,   setSortByScore]   = useState(true);

  // One-time: campaigns + draft count + last cron run.
  // These used to swallow errors with `.catch(() => {})` (GAPS 4.2) — a failed
  // campaigns load left the filter dropdown mysteriously empty. Now surfaced via
  // configError (rendered as a slim strip near the contacts error panel).
  useEffect(() => {
    apiFetch<Campaign[]>("/api/campaigns").then(({ data, error }) => {
      if (Array.isArray(data)) setCampaigns(data);
      else if (error) setConfigError(`Couldn't load campaigns — ${error}`);
    });

    // channel=email: these tiles link to and mirror /review, which lists EMAIL
    // drafts only — an unfiltered count would include social/phone drafts that
    // never appear in that queue.
    // count=true: both tiles render a bare number. They previously fetched the
    // full log lists (every subject and body) just to read `.length`.
    apiFetch<{ count: number }>("/api/email-logs?status=draft&channel=email&count=true").then(
      ({ data, error }) => {
        if (typeof data?.count === "number") setDraftCount(data.count);
        else if (error) setConfigError(`Couldn't load draft count — ${error}`);
      }
    );

    apiFetch<{ count: number }>("/api/email-logs?status=approved&channel=email&count=true").then(
      ({ data, error }) => {
        if (typeof data?.count === "number") setApprovedCount(data.count);
        else if (error) setConfigError(`Couldn't load approved count — ${error}`);
      }
    );

    apiFetch<CronRunDoc[]>("/api/cron-runs?limit=1").then(({ data }) => {
      // A missing/errored cron-run history is a normal "no runs yet" state, not
      // a user-facing error — keep the existing behaviour.
      setLastCronRun(Array.isArray(data) && data.length > 0 ? data[0] : "none");
    });
  }, []);

  // Contacts — re-fetched on filter change
  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ stats: "true" });
    if (campaignId)    p.set("campaignId",    campaignId);
    if (pipelineStage) p.set("pipelineStage", pipelineStage);
    if (leadSource)    p.set("leadSource",    leadSource);
    if (hotOnly)       p.set("hot",           "true");
    if (sortByScore)   p.set("sort",          "score");
    try {
      const res = await fetch(`/api/contacts?${p.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setContacts(await res.json() as ContactRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId, pipelineStage, leadSource, hotOnly, sortByScore]);

  useEffect(() => { loadContacts(); }, [loadContacts]);

  // Client-side search filter. contactName/contactEmail/phone/facebook/
  // instagram are all optional (multi-channel scraped leads may have none
  // but businessName) — optional-chain each so a missing field just fails to
  // match instead of throwing.
  const filtered = search.trim()
    ? contacts.filter(({ businessName, contactName, contactEmail, phone, facebook, instagram }) => {
        const q = search.toLowerCase();
        return (
          businessName.toLowerCase().includes(q) ||
          (contactName?.toLowerCase().includes(q) ?? false) ||
          (contactEmail?.toLowerCase().includes(q) ?? false) ||
          (phone?.toLowerCase().includes(q) ?? false) ||
          (facebook?.toLowerCase().includes(q) ?? false) ||
          (instagram?.toLowerCase().includes(q) ?? false)
        );
      })
    : contacts;

  // Derived groups
  const repliedGroup = [...filtered]
    .filter((c) => ["replied", "call_booked", "proposal_sent"].includes(c.pipelineStage))
    .sort((a, b) => {
      // Sort overdue-first: contacts with a past nextActionAt bubble to the top.
      // "Overdue" = nextActionAt is non-null AND in a past Manila day.
      const now = new Date();
      const nowDayStartMs = getManilaDayStartMs(now);
      const aOverdue = a.nextActionAt &&
        getManilaDayStartMs(new Date(a.nextActionAt)) < nowDayStartMs;
      const bOverdue = b.nextActionAt &&
        getManilaDayStartMs(new Date(b.nextActionAt)) < nowDayStartMs;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      // Within the same overdue/non-overdue group, sort by most-recently-replied
      const da = a.repliedAt ? new Date(a.repliedAt).getTime() : 0;
      const db = b.repliedAt ? new Date(b.repliedAt).getTime() : 0;
      return db - da;
    });

  const inSequenceGroup = filtered.filter((c) =>
    ["not_started", "contacted"].includes(c.pipelineStage)
  );

  const closedGroup = filtered.filter((c) =>
    ["won", "lost"].includes(c.pipelineStage)
  );

  const navigate = useCallback((id: string) => router.push(`/contacts/${id}`), [router]);

  const noContacts = !loading && !error && filtered.length === 0;
  const kickerDate = getKickerDate();
  const greeting   = getManilaGreeting();

  // Styled select (chip appearance)
  const selectStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: "1px solid #D3C9B4",
    backgroundColor: "transparent",
    borderRadius: 6,
    padding: "7px 34px 7px 14px",
    color: INK,
    cursor: "pointer",
    appearance: "none",
    outline: "none",
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px", minHeight: "100%" }}>

      {/* ── 1. HEADER ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        {/* Left: kicker + greeting */}
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
            {kickerDate} · {repliedGroup.length} REPLIED / {draftCount} DRAFTS · {approvedCount} APPROVED
          </MonoLabel>
          <h1
            style={{
              fontFamily: serif,
              fontSize: 46,
              fontWeight: 400,
              color: INK,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Magandang {greeting}, Shikks
          </h1>
        </div>

        {/* Right: search input */}
        <div style={{ position: "relative", width: 200, marginTop: 6, flexShrink: 0 }}>
          <Search
            size={13}
            color={FAINT2}
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          />
          <input
            className={monoInputClass}
            style={{ paddingLeft: 36 }}
            placeholder="SEARCH…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── 2. PRIORITY PANELS ── */}
      <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
        {/* Replies panel */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => repliedRef.current?.scrollIntoView({ behavior: "smooth" })}
          onKeyDown={(e) => {
            if (e.key === "Enter") repliedRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          style={{
            flex: 1,
            backgroundColor: "#F8F5EC",
            border: "1px solid #D3C9B4",
            borderLeft: `3px solid ${CLAY}`,
            borderRadius: 10,
            padding: "20px 22px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 18,
            boxShadow: panelShadow,
          }}
        >
          <span
            style={{
              fontFamily: serif,
              fontSize: 44,
              fontWeight: 400,
              color: INK,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {repliedGroup.length}
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: grotesk,
                fontWeight: 600,
                fontSize: 16,
                color: INK,
                lineHeight: 1.2,
              }}
            >
              New replies
            </div>
            <MonoLabel style={{ color: FAINT, display: "block", marginTop: 3 }}>
              YOUR PERSONAL FOLLOW-UP
            </MonoLabel>
          </div>
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: CLAY,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            OPEN →
          </span>
        </div>

        {/* Drafts panel */}
        <Link
          href="/review"
          style={{
            flex: 1,
            backgroundColor: "#F8F5EC",
            border: "1px solid #D3C9B4",
            borderLeft: `3px solid ${AMBER}`,
            borderRadius: 10,
            padding: "20px 22px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 18,
            textDecoration: "none",
            color: "inherit",
            boxShadow: panelShadow,
          }}
        >
          <span
            style={{
              fontFamily: serif,
              fontSize: 44,
              fontWeight: 400,
              color: INK,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {draftCount}
          </span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: grotesk,
                fontWeight: 600,
                fontSize: 16,
                color: INK,
                lineHeight: 1.2,
              }}
            >
              Drafts to approve
            </div>
            <MonoLabel style={{ color: FAINT, display: "block", marginTop: 3 }}>
              BEFORE NEXT SEND · {countdown}
            </MonoLabel>
          </div>
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: AMBER_TEXT,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            REVIEW →
          </span>
        </Link>
      </div>

      {/* ── 3. ENGINE RUN STRIP ── */}
      {lastCronRun !== null && (() => {
        const inWindow = isWithinSendWindow();

        if (lastCronRun === "none") {
          return (
            <div
              style={{
                marginTop: 14,
                padding: "10px 16px",
                backgroundColor: "#F4F0E6",
                border: "1px solid #D3C9B4",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: FAINT,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                NO ENGINE RUNS RECORDED YET
              </span>
            </div>
          );
        }

        const run = lastCronRun;
        const runAgeMs = Date.now() - new Date(run.startedAt).getTime();
        const isStale = inWindow && runAgeMs > STALE_PINGER_THRESHOLD_MS;
        const hasErrors = run.errorCount > 0;

        const stripBg   = isStale ? "#FEF5E4" : hasErrors ? "#FEF0EA" : "#F4F0E6";
        const stripBorderLeft = isStale ? `3px solid ${AMBER}` : hasErrors ? `3px solid ${CLAY}` : "1px solid #D3C9B4";

        return (
          <div
            style={{
              marginTop: 14,
              padding: "10px 16px",
              backgroundColor: stripBg,
              border: "1px solid #D3C9B4",
              borderLeft: stripBorderLeft,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: FAINT,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              LAST ENGINE RUN
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: INK,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                whiteSpace: "nowrap",
              }}
            >
              {timeAgoShort(run.startedAt)}
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: FAINT,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                whiteSpace: "nowrap",
              }}
            >
              {run.summary.sent} SENT
            </span>
            {hasErrors && (
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: CLAY,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  whiteSpace: "nowrap",
                }}
              >
                {run.errorCount} ERROR{run.errorCount !== 1 ? "S" : ""}
              </span>
            )}
            {isStale && (
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: AMBER_TEXT,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                — PINGER STALE
              </span>
            )}
          </div>
        );
      })()}

      {/* ── 4. FILTER ROW ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 24,
          flexWrap: "wrap",
        }}
      >
        <MonoLabel style={{ color: FAINT, marginRight: 4 }}>FILTER</MonoLabel>

        {/* Campaign chip */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            style={selectStyle}
          >
            <option value="">CAMPAIGN</option>
            {campaigns.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name.toUpperCase()}
              </option>
            ))}
          </select>
          <span style={{ position: "absolute", right: 8, pointerEvents: "none", color: FAINT, fontSize: 9 }}>
            ▾
          </span>
        </div>

        {/* Stage chip */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <select
            value={pipelineStage}
            onChange={(e) => setPipelineStage(e.target.value)}
            style={selectStyle}
          >
            <option value="">STAGE</option>
            {Object.entries(PIPELINE_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label.toUpperCase()}
              </option>
            ))}
          </select>
          <span style={{ position: "absolute", right: 8, pointerEvents: "none", color: FAINT, fontSize: 9 }}>
            ▾
          </span>
        </div>

        {/* Source chip */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
          <select
            value={leadSource}
            onChange={(e) => setLeadSource(e.target.value)}
            style={selectStyle}
          >
            <option value="">SOURCE</option>
            <option value="cold_email">COLD EMAIL</option>
            <option value="referral">REFERRAL</option>
            <option value="event_connection">EVENT</option>
            <option value="other">OTHER</option>
          </select>
          <span style={{ position: "absolute", right: 8, pointerEvents: "none", color: FAINT, fontSize: 9 }}>
            ▾
          </span>
        </div>

        {/* HOT ONLY toggle */}
        <button
          onClick={() => setHotOnly((v) => !v)}
          style={{
            fontFamily: mono,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            border: "1px solid #D8B45E",
            backgroundColor: hotOnly ? "#F3E9CE" : "transparent",
            borderRadius: 6,
            padding: "7px 14px",
            color: HOT_TEXT,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              backgroundColor: HOT_TEXT,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          HOT ONLY
        </button>

        {/* Sort toggle — right-aligned */}
        <button
          onClick={() => setSortByScore((v) => !v)}
          style={{
            marginLeft: "auto",
            fontFamily: mono,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            background: "none",
            border: "none",
            color: FAINT,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {sortByScore ? "SORT: ENGAGEMENT ↓" : "SORT: NEWEST"}
        </button>
      </div>

      {/* ── 5. CONTACT GROUPS ── */}
      <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 36 }}>

        {/* Loading state */}
        {loading && (
          <MonoLabel
            style={{
              display: "block",
              textAlign: "center",
              padding: "56px 0",
              color: FAINT,
            }}
          >
            LOADING…
          </MonoLabel>
        )}

        {/* Error state */}
        {!loading && error && (
          <Panel style={{ padding: "22px 28px" }}>
            <MonoLabel style={{ color: CLAY }}>{error}</MonoLabel>
          </Panel>
        )}

        {/* Config-load error (campaigns / draft count) — previously swallowed */}
        {configError && (
          <Panel style={{ padding: "16px 28px" }}>
            <MonoLabel style={{ color: CLAY }}>{configError}</MonoLabel>
          </Panel>
        )}

        {/* Empty state */}
        {noContacts && (
          <MonoLabel
            style={{
              display: "block",
              textAlign: "center",
              padding: "56px 0",
              color: FAINT,
            }}
          >
            NO CONTACTS YET · IMPORT A CSV TO GET STARTED
          </MonoLabel>
        )}

        {!loading && !error && (
          <>
            {/* REPLIED — YOUR MOVE */}
            {repliedGroup.length > 0 && (
              <div ref={repliedRef}>
                <SectionHeader
                  title="REPLIED — YOUR MOVE"
                  count={repliedGroup.length}
                  accent={CLAY}
                />
                <div style={{ marginTop: 14 }}>
                  <GroupPanel rows={repliedGroup} group="replied" onNavigate={navigate} />
                </div>
              </div>
            )}

            {/* IN SEQUENCE */}
            {inSequenceGroup.length > 0 && (
              <div>
                <SectionHeader title="IN SEQUENCE" count={inSequenceGroup.length} />
                <div style={{ marginTop: 14 }}>
                  <GroupPanel rows={inSequenceGroup} group="in_sequence" onNavigate={navigate} />
                </div>
              </div>
            )}

            {/* CLOSED */}
            {closedGroup.length > 0 && (
              <div>
                <SectionHeader title="CLOSED" count={closedGroup.length} />
                <div style={{ marginTop: 14 }}>
                  <GroupPanel rows={closedGroup} group="closed" onNavigate={navigate} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

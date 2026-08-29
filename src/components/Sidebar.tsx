"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { useNextSendCountdown } from "./useNextSendCountdown";
import { useSendingEnabled } from "./useSendingEnabled";

const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Outreach",     href: "/outreach",    showBadge: false },
  { index: "04", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "05", label: "Import",       href: "/import",      showBadge: false },
  // "Blocked" is the user-facing name for the suppression list; the route,
  // API and Suppression model keep the domain term.
  { index: "06", label: "Blocked",      href: "/suppressions",showBadge: false },
  { index: "07", label: "Compose",      href: "/compose",     showBadge: false },
  { index: "08", label: "Templates",    href: "/templates",   showBadge: false },
  { index: "09", label: "Settings",     href: "/settings",    showBadge: false },
];

/* ── Typography helpers (inline so no "use client" needed in ui.tsx) ── */
const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

export default function Sidebar() {
  const pathname  = usePathname();
  // No countdown when cron sending is off in /settings — nothing is scheduled,
  // so a running timer would promise a send that never happens. Tri-state:
  // null = not read yet, which renders neither the timer nor the off marker.
  const sendingEnabled = useSendingEnabled();
  const showCountdown = sendingEnabled === true;
  const countdown = useNextSendCountdown(showCountdown);
  const [draftCount, setDraftCount] = useState<number>(0);

  // Fetch pending draft count on mount and whenever the route changes.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // channel=email: the badge sits on "Review Queue", and /review lists
        // EMAIL drafts only — an unfiltered fetch here counts social/phone
        // drafts too and over-states the badge relative to what /review shows.
        // count=true: this effect re-runs on every route change, and the badge
        // only needs a number — the previous list fetch pulled every draft's
        // subject and body across the wire on each navigation.
        const res = await fetch(
          "/api/email-logs?status=draft&channel=email&count=true"
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { count?: number };
        if (!cancelled && typeof data.count === "number") {
          setDraftCount(data.count);
        }
      } catch {
        // silently swallow — badge stays hidden
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pathname]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // network hiccup — still redirect, the cookie may already be stale
    }
    window.location.href = "/login";
  }

  return (
    <aside
      style={{
        width: 268,
        minWidth: 268,
        maxWidth: 268,
        height: "100vh",
        backgroundColor: "#161310",
        padding: "28px 20px",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        overflowY: "auto",
      }}
    >
      {/* ── Wordmark ─────────────────────────────────── */}
      <div>
        <div
          style={{
            fontFamily: serif,
            fontStyle: "italic",
            fontSize: 28,
            color: "#F4EEDF",
            lineHeight: 1.15,
          }}
        >
          Shikks
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            letterSpacing: "0.28em",
            color: "#8B8371",
            textTransform: "uppercase",
            marginTop: 7,
          }}
        >
          TRACKER · OUTREACH OS
        </div>
        {/* divider */}
        <div
          style={{
            height: 1,
            backgroundColor: "#2E2A22",
            marginTop: 24,
            marginBottom: 24,
          }}
        />
      </div>

      {/* ── Navigation ───────────────────────────────── */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {NAV_ITEMS.map(({ index, label, href, showBadge }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 6,
                textDecoration: "none",
                backgroundColor: active ? "#F4EEDF" : "transparent",
                color: active ? "#161310" : "#CFC6B4",
                fontWeight: active ? 600 : 500,
                transition: "background-color 120ms ease, color 120ms ease",
              }}
              /* Hover is handled via a CSS class in globals; inline style wins
                 on base state, so we layer a className for the hover rule. */
              className={active ? "" : "sidebar-nav-inactive"}
            >
              {/* Mono index number — always dim regardless of active state */}
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: "#6E6653",
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                {index}
              </span>

              {/* Grotesk label */}
              <span
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  flex: 1,
                  lineHeight: 1.2,
                }}
              >
                {label}
              </span>

              {/* Amber draft badge — only on Review Queue, hidden when 0 */}
              {showBadge && draftCount > 0 && (
                <span
                  style={{
                    backgroundColor: "#C68A1E",
                    color: "#221B08",
                    fontFamily: mono,
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: "2px 8px",
                    lineHeight: 1.6,
                    flexShrink: 0,
                  }}
                >
                  {draftCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom: countdown + user chip ────────────── */}
      <div style={{ marginTop: "auto" }}>
        {/* divider above bottom section */}
        <div
          style={{
            height: 1,
            backgroundColor: "#2E2A22",
            marginBottom: 20,
          }}
        />

        {/* NEXT SEND label + live countdown. With cron sending switched off in
            /settings there is nothing to count down to, so the timer is
            replaced by a muted status line — the absence is stated, not
            silent. `null` (settings not read yet) shows neither. */}
        {showCountdown && (
          <>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                letterSpacing: "0.20em",
                textTransform: "uppercase",
                color: "#6E6653",
                marginBottom: 7,
              }}
            >
              NEXT SEND
            </div>

            <div
              style={{
                fontFamily: mono,
                fontSize: 17,
                fontWeight: 600,
                color: "#F4EEDF",
                marginBottom: 22,
                letterSpacing: "0.04em",
              }}
            >
              {countdown}
            </div>
          </>
        )}

        {sendingEnabled === false && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 22,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "#6E6653",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "#8B8371",
              }}
            >
              SENDING OFF
            </span>
          </div>
        )}

        {/* User chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Avatar tile */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              backgroundColor: "#3A342A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: mono,
                fontSize: 12,
                fontWeight: 600,
                color: "#E8C877",
                lineHeight: 1,
              }}
            >
              SH
            </span>
          </div>

          {/* Name */}
          <span
            style={{
              fontFamily: grotesk,
              fontSize: 14.5,
              color: "#CFC6B4",
            }}
          >
            Shikks
          </span>
        </div>

        {/* Log out — visually subordinate to nav + user chip */}
        <button
          type="button"
          onClick={handleLogout}
          className="sidebar-nav-inactive"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 14,
            padding: "8px 14px",
            border: "none",
            borderRadius: 6,
            backgroundColor: "transparent",
            color: "#6E6653",
            fontFamily: grotesk,
            fontSize: 13,
            cursor: "pointer",
            width: "100%",
          }}
        >
          <LogOut size={13} strokeWidth={2} />
          Log out
        </button>
      </div>
    </aside>
  );
}

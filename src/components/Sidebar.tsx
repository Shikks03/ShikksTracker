"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNextSendCountdown } from "./useNextSendCountdown";

const NAV_ITEMS = [
  { index: "01", label: "Dashboard",    href: "/",            showBadge: false },
  { index: "02", label: "Review Queue", href: "/review",      showBadge: true  },
  { index: "03", label: "Campaigns",    href: "/campaigns",   showBadge: false },
  { index: "04", label: "Import",       href: "/import",      showBadge: false },
  { index: "05", label: "Suppressions", href: "/suppressions",showBadge: false },
];

/* ── Typography helpers (inline so no "use client" needed in ui.tsx) ── */
const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

export default function Sidebar() {
  const pathname  = usePathname();
  const countdown = useNextSendCountdown();
  const [draftCount, setDraftCount] = useState<number>(0);

  // Fetch pending draft count on mount and whenever the route changes.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/email-logs?status=draft");
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setDraftCount(data.length);
        }
      } catch {
        // silently swallow — badge stays hidden
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pathname]);

  return (
    <aside
      style={{
        width: 238,
        minWidth: 238,
        maxWidth: 238,
        height: "100vh",
        backgroundColor: "#161310",
        padding: "22px 16px",
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
            fontSize: 24,
            color: "#F4EEDF",
            lineHeight: 1.15,
          }}
        >
          Shikks
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 9.5,
            letterSpacing: "0.28em",
            color: "#8B8371",
            textTransform: "uppercase",
            marginTop: 5,
          }}
        >
          TRACKER · OUTREACH OS
        </div>
        {/* divider */}
        <div
          style={{
            height: 1,
            backgroundColor: "#2E2A22",
            marginTop: 18,
            marginBottom: 18,
          }}
        />
      </div>

      {/* ── Navigation ───────────────────────────────── */}
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                gap: 8,
                padding: "8px 10px",
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
                  fontSize: 10,
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
                  fontSize: 13.5,
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
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 4,
                    padding: "1px 6px",
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
            marginBottom: 14,
          }}
        />

        {/* NEXT SEND label */}
        <div
          style={{
            fontFamily: mono,
            fontSize: 9.5,
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "#6E6653",
            marginBottom: 5,
          }}
        >
          NEXT SEND
        </div>

        {/* Live countdown */}
        <div
          style={{
            fontFamily: mono,
            fontSize: 15,
            fontWeight: 600,
            color: "#F4EEDF",
            marginBottom: 16,
            letterSpacing: "0.04em",
          }}
        >
          {countdown}
        </div>

        {/* User chip */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Avatar tile */}
          <div
            style={{
              width: 28,
              height: 28,
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
                fontSize: 11,
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
              fontSize: 13,
              color: "#CFC6B4",
            }}
          >
            Shikks
          </span>
        </div>
      </div>
    </aside>
  );
}

import Link from "next/link";
import { serif, grotesk, mono, INK, FAINT, FAINT2, PAPER, CLAY } from "@/components/tokens";
import { LAST_UPDATED } from "@/lib/legal";

/**
 * Shell for the three public legal pages (/privacy, /terms, /data-deletion).
 *
 * Full-screen fixed overlay for the same reason the login page uses one: the
 * root layout always renders the dashboard Sidebar, and these pages are read by
 * logged-out strangers — a Meta reviewer, or a business asking to be deleted —
 * who must not see the app's navigation. Unlike the login overlay this one
 * scrolls, since the content is long.
 *
 * Server component on purpose: static prose, no hooks, nothing to fetch.
 */
export default function LegalLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: PAPER,
        overflowY: "auto",
        zIndex: 9999,
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "56px 24px 96px" }}>
        <span
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: FAINT,
            display: "block",
            marginBottom: 14,
          }}
        >
          SHIKKS TRACKER
        </span>

        <h1
          style={{
            fontFamily: serif,
            fontSize: 40,
            lineHeight: 1.1,
            color: INK,
            margin: "0 0 16px",
          }}
        >
          {title}
        </h1>

        <p
          style={{
            fontFamily: grotesk,
            fontSize: 15,
            lineHeight: 1.65,
            color: FAINT2,
            margin: "0 0 8px",
          }}
        >
          {intro}
        </p>

        <p
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: FAINT,
            margin: "0 0 40px",
          }}
        >
          Last updated {LAST_UPDATED}
        </p>

        <div style={{ fontFamily: grotesk, fontSize: 15, lineHeight: 1.7, color: INK }}>
          {children}
        </div>

        <nav
          style={{
            marginTop: 56,
            paddingTop: 20,
            borderTop: `1px solid ${FAINT}33`,
            fontFamily: mono,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <Link href="/privacy" style={{ color: CLAY, textDecoration: "none" }}>
            Privacy
          </Link>
          <Link href="/terms" style={{ color: CLAY, textDecoration: "none" }}>
            Terms
          </Link>
          <Link href="/data-deletion" style={{ color: CLAY, textDecoration: "none" }}>
            Data deletion
          </Link>
        </nav>
      </div>
    </div>
  );
}

/** Section heading. */
export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: serif,
        fontSize: 24,
        lineHeight: 1.2,
        color: INK,
        margin: "40px 0 12px",
      }}
    >
      {children}
    </h2>
  );
}

/** Body paragraph. */
export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 14px" }}>{children}</p>;
}

/** Bulleted list. */
export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul style={{ margin: "0 0 14px", paddingLeft: 22, listStyleType: "square" }}>
      {children}
    </ul>
  );
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li style={{ margin: "0 0 7px" }}>{children}</li>;
}

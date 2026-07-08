/**
 * ui.tsx — Shared design-system primitives for the "Editorial Terminal" redesign.
 *
 * No "use client" — these components are purely presentational and safe to
 * render in both Server and Client components. (Button uses only CSS hover via
 * Tailwind classes, no React state.)
 */

import React from "react";

/* ─────────────────────────────────────────────────────────────────── */
/* Typography helpers                                                   */
/* ─────────────────────────────────────────────────────────────────── */

const mono    = "var(--font-jetbrains)";
const grotesk = "var(--font-familjen)";

/** Soft warm-tinted shadow for panels/cards only — never rows or chips. */
export const panelShadow =
  "0 1px 2px rgba(26,23,18,0.04), 0 2px 6px rgba(26,23,18,0.05)";

/** Standard interactive transition. */
export const uiTransition =
  "background-color 130ms ease, border-color 130ms ease, box-shadow 130ms ease, color 130ms ease";

/* ─────────────────────────────────────────────────────────────────── */
/* MonoLabel                                                            */
/* ─────────────────────────────────────────────────────────────────── */

interface MonoLabelProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Inline mono microlabel — uppercase, 10px, faint color by default.
 * Pass `style` or `className` to override size / color / spacing.
 */
export function MonoLabel({ children, className = "", style }: MonoLabelProps) {
  return (
    <span
      className={className}
      style={{
        fontFamily: mono,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "#8E836C",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Panel                                                                */
/* ─────────────────────────────────────────────────────────────────── */

type PanelProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Warm panel card — `#F8F5EC` surface, 1px hairline border, 10px radius.
 */
export function Panel({ children, className = "", style, ...rest }: PanelProps) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: "#F8F5EC",
        border: "1px solid #D3C9B4",
        borderRadius: 10,
        boxShadow: panelShadow,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* InitialsTile                                                         */
/* ─────────────────────────────────────────────────────────────────── */

interface InitialsTileProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}

/**
 * Square tile showing 1–2 initials from the contact/entity name.
 * Default size 34px, radius 6px.
 */
export function InitialsTile({
  name,
  size = 40,
  className = "",
  style,
}: InitialsTileProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        backgroundColor: "#ECE5D2",
        border: "1px solid #DCD2BC",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#5A5344",
          textTransform: "uppercase",
          lineHeight: 1,
        }}
      >
        {getInitials(name)}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* HotChip                                                              */
/* ─────────────────────────────────────────────────────────────────── */

/**
 * Amber mono "HOT" badge for high-engagement contacts (score ≥ 5).
 */
export function HotChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: mono,
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        border: "1px solid #D8B45E",
        color: "#8A6212",
        backgroundColor: "#F3E9CE",
        borderRadius: 4,
        padding: "2px 7px",
        lineHeight: 1.6,
        flexShrink: 0,
      }}
    >
      HOT
      <span
        title="+1 open · +3 click · +10 reply → score ≥ 5 = HOT"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 11,
          height: 11,
          borderRadius: "50%",
          border: "1px solid #C9A040",
          fontSize: 8,
          lineHeight: 1,
          cursor: "help",
          flexShrink: 0,
          letterSpacing: 0,
          textTransform: "none",
        }}
      >
        ?
      </span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* PIPELINE_META + PipelineMarker                                       */
/* ─────────────────────────────────────────────────────────────────── */

export const PIPELINE_META: Record<string, { label: string; color: string }> = {
  not_started:    { label: "Not Started",    color: "#A99E86" },
  contacted:      { label: "Contacted",      color: "#5B6472" },
  replied:        { label: "Replied",        color: "#BC5228" },
  call_booked:    { label: "Call Booked",    color: "#1C6E6A" },
  proposal_sent:  { label: "Proposal Sent",  color: "#B8862B" },
  won:            { label: "Won",            color: "#1C6E3A" },
  lost:           { label: "Lost",           color: "#A23B28" },
};

interface PipelineMarkerProps {
  stage: string;
  className?: string;
}

/**
 * Inline pipeline indicator: 7px solid square + grotesk label.
 */
export function PipelineMarker({ stage, className = "" }: PipelineMarkerProps) {
  const meta  = PIPELINE_META[stage];
  const color = meta?.color ?? "#A99E86";
  const label = meta?.label ?? stage;

  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 1,
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: grotesk,
          fontSize: 14,
          color: "#1A1712",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* SectionHeader                                                        */
/* ─────────────────────────────────────────────────────────────────── */

interface SectionHeaderProps {
  title: string;
  count?: number;
  accent?: string;
  className?: string;
}

/**
 * Full-width section header: mono title + optional count chip + hairline rule.
 */
export function SectionHeader({
  title,
  count,
  accent,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: 10 }}
    >
      <span
        style={{
          fontFamily: mono,
          fontSize: 11.5,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: accent ?? "#8E836C",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>

      {count !== undefined && (
        <span
          style={{
            fontFamily: mono,
            fontSize: 11,
            border: "1px solid #D8CFBB",
            backgroundColor: "#F8F5EC",
            borderRadius: 4,
            padding: "2px 7px",
            color: "#8E836C",
            flexShrink: 0,
          }}
        >
          {count}
        </span>
      )}

      <span
        style={{
          flex: 1,
          height: 1,
          backgroundColor: "#D8CFBB",
          display: "block",
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Button                                                               */
/* ─────────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "outline" | "danger-outline" | "dark";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#1C4B3A] text-[#F4EEDF] font-semibold hover:bg-[#163C2E]",
  outline:
    "bg-transparent text-[#1A1712] font-medium border border-[#C9BEA6] hover:bg-[#F1EBDD]",
  "danger-outline":
    "bg-transparent text-[#A23B28] font-medium border border-[#D3C0B4] hover:bg-[#F5E9E2]",
  dark:
    "bg-[#161310] text-[#F4EEDF] font-semibold hover:bg-[#1A1510]",
};

/**
 * Design-system button with four variants.
 * Hover states use Tailwind classes (no React state needed).
 */
export function Button({
  variant = "primary",
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[7px] text-[14.5px] px-[18px] py-[10px] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <button
      className={`${base} ${VARIANT_CLASSES[variant]} ${className}`}
      disabled={disabled}
      style={{ fontFamily: grotesk }}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────── */
/* Input class strings                                                  */
/* ─────────────────────────────────────────────────────────────────── */

/**
 * Tailwind class string for standard text inputs.
 * Usage: `<input className={inputClass} ... />`
 */
export const inputClass =
  "w-full bg-[#FCFAF3] border border-[#D3C9B4] rounded-[7px] font-sans text-[15px] text-[#1A1712] px-[14px] py-[10px] focus:border-[#A99E86] outline-none placeholder:text-[#A2957A] transition-colors duration-150";

/**
 * Tailwind class string for mono uppercase inputs (e.g. email filter).
 * Usage: `<input className={monoInputClass} ... />`
 */
export const monoInputClass =
  "w-full bg-[#FCFAF3] border border-[#D3C9B4] rounded-[7px] font-mono text-[12px] uppercase tracking-[0.08em] text-[#1A1712] px-[14px] py-[10px] focus:border-[#A99E86] outline-none placeholder:text-[#A2957A] transition-colors duration-150";

/**
 * tokens.ts — Editorial Terminal design tokens (fonts + palette).
 *
 * Single source of truth for the inline-style hex convention used across pages.
 * Consolidated 2026-07-11 (Task 5.1) from per-page duplicated consts. Plain
 * string constants — safe in both Server and Client components.
 */

// Fonts — resolve to the CSS variables set on <html> in layout.tsx.
export const serif   = "var(--font-instrument-serif)";
export const grotesk = "var(--font-familjen)";
export const mono    = "var(--font-jetbrains)";

// Core palette
export const INK    = "#1A1712"; // primary text
export const FAINT  = "#8E836C"; // muted labels
export const FAINT2 = "#9A8F76"; // secondary muted
export const CLAY   = "#BC5228"; // accent / danger / replied
export const PAPER  = "#ECE7D9"; // warm page surface (login)

// Amber family — HOT / attention states
export const AMBER      = "#C68A1E"; // amber border/base
export const AMBER_TEXT = "#96712A"; // amber text on light bg
export const HOT_TEXT   = "#8A6212"; // HOT chip text
export const HOT_BG     = "#F6ECCE"; // HOT chip background

// Forest greens — two distinct roles (per the design handoff, NOT a drift):
export const FOREST_ACTION = "#1C4B3A"; // primary buttons / actions
export const FOREST_WON    = "#1C6E3A"; // pipeline "won" state

// Muted green — a completed/sent marker
export const GREEN_SENT = "#5A7D5A";

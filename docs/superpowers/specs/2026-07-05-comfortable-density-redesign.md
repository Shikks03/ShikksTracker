# Comfortable Density Pass — Design Spec

**Date:** 2026-07-05
**Status:** Approved by user
**Scope:** Visual-only. No behavior, data, routing, or copy changes.

## Context

The "Editorial Terminal" redesign (see `design reference/design_handoff_shikkstracker_redesign/README.md`, option 4a) shipped 2026-07-05. The user's verdict after seeing it: the aesthetic is right but **everything is too compact**. This pass keeps the palette, fonts, and layout structure intact and systematically scales type, padding, and whitespace up to a "Comfortable" density level, plus adds subtle depth (soft shadows) and gentle motion (short transitions, one fade-up on load).

Decisions from the design interview:

| Question | Decision |
|---|---|
| Density level | **Comfortable** — type up ~15–20%, real row padding, 40px tiles (user picked B of A/B/C mockups) |
| Aesthetic scope | Keep Editorial Terminal palette/fonts/structure; spacing and type are the fix |
| Page width | **Full-bleed** — content keeps filling the viewport beside the sidebar; no max-width column |
| Sidebar | Scales up with everything else |
| Page coverage | Uniform pass across all six pages; no page gets special layout rework |
| Polish | Subtle depth **and** gentle motion (both selected) |
| Implementation approach | **C — Hybrid**: upgrade `ui.tsx` primitives to the new scale, then apply a fixed mapping table to page-level inline styles |

## 1. Scale mapping table (single source of truth)

Implementers apply this table mechanically. **Never invent new values.** If a value in page code isn't listed, round to the nearest listed "current" value and use its mapping; if genuinely ambiguous, choose the more generous option.

### Typography

| Element | Current | New |
|---|---|---|
| Mono microlabel (`MonoLabel` default) | 10px | 11px |
| SectionHeader title | 10.5px | 11.5px |
| SectionHeader count chip | 10px, padding 1×5 | 11px, padding 2×7 |
| HotChip | 9.5px, padding 1×5 | 10.5px, padding 2×7 |
| Meta lines (mono uppercase row subtext) | 10px | 11px |
| Sidebar mono microlabels | 9.5px | 10.5px |
| Body / row names (grotesk) | 13.5px | 15.5px |
| PipelineMarker label / square | 12.5px / 7px sq | 14px / 8px sq |
| Button text | 13.5px | 14.5px |
| Input text (`inputClass`) | 13.5px | 15px |
| Mono input (`monoInputClass`) | 11px | 12px |
| InitialsTile default size / font / radius | 34px / 11px / 6px | 40px / 12.5px / 7px |
| Sidebar wordmark (serif italic) | 24px | 28px |
| Sidebar nav labels | ~13–14px | 15px |
| Serif display titles (page headers, greeting) | varies | +15–20%, rounded to whole px |

### Spacing

| Element | Current | New |
|---|---|---|
| Row padding (list rows) | 8×10 | 14×16 |
| Button padding | 8×14 | 10×18 |
| Input padding | 8×11 | 10×14 |
| Flex gaps in rows | 8 / 10 | 10 / 14 |
| Panel internal padding | e.g. 14 / 16 | 20 / 24 (+~50%) |
| Page padding | e.g. 28 | 40 |
| Section gaps / vertical rhythm | e.g. 24 | 32 (+~50%) |
| Sidebar width | 238px | 268px |
| Sidebar padding | 22×16 | 28×20 |
| Meta line top margin (row subtext) | 0–2px | 3px |

General rule for unlisted spacing: multiply by ~1.4–1.5 and round to an even number.

## 2. Shared primitives (`src/components/ui.tsx`)

Update in place to the new scale (values above): `MonoLabel`, `Panel`, `InitialsTile`, `HotChip`, `PipelineMarker`, `SectionHeader`, `Button`, `inputClass`, `monoInputClass`.

New exports:

```ts
/** Soft warm-tinted shadow for panels/cards only — never rows or chips. */
export const panelShadow =
  "0 1px 2px rgba(26,23,18,0.04), 0 2px 6px rgba(26,23,18,0.05)";

/** Standard interactive transition. */
export const uiTransition =
  "background-color 130ms ease, border-color 130ms ease, box-shadow 130ms ease, color 130ms ease";
```

`Panel` applies `boxShadow: panelShadow` by default. `Button` transition duration moves from 100ms to 150ms. All primitives keep their existing prop APIs — no consumer signature changes.

## 3. Sidebar (`src/components/Sidebar.tsx`)

Width 238 → 268px (all three of width/minWidth/maxWidth), padding 22×16 → 28×20, wordmark 24 → 28px, mono sublabel 9.5 → 10.5px, nav labels → 15px with proportionally roomier item padding/gaps (apply the general +~40–50% rule). Structure, colors, badge logic, and countdown unchanged.

## 4. Depth & motion

- **Shadows:** `panelShadow` on Panel (automatic) and on any page-local card that visually reads as a panel. Never on rows, chips, or the sidebar. The review page's focus card keeps its existing, stronger shadow.
- **Hovers:** list rows gain `backgroundColor: #F1EBDD` on hover (CSS class in `globals.css` where inline styles would block it, same pattern as `.sidebar-nav-inactive:hover`). All interactive elements use `uiTransition` (or Tailwind `duration-150`) instead of instant changes.
- **Load animation:** one keyframe in `globals.css`:

```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
.page-enter { animation: fade-up 200ms ease-out; }

@media (prefers-reduced-motion: reduce) {
  .page-enter { animation: none; }
}
```

Applied once per page to the main content wrapper. No staggering, no bounces, nothing else animates on load.

## 5. Page-level pass

All six page files get the mapping table applied to their inline style objects, uniformly and full-bleed (no max-width wrappers, no layout restructuring):

- `src/app/page.tsx` (dashboard)
- `src/app/review/page.tsx`
- `src/app/campaigns/page.tsx`
- `src/app/import/page.tsx`
- `src/app/suppressions/page.tsx`
- `src/app/contacts/[id]/page.tsx`

Existing conventions stay: inline style objects with exact hexes, no emoji, no pastel pills. Row hover tint and `.page-enter` are added per page as described in §4.

## 6. Implementation & verification

Chunked for Sonnet subagent implementation with personal review of each diff (per the user's standing workflow):

1. **Chunk 1 (sequential, first):** `ui.tsx` + `Sidebar.tsx` + `globals.css` — the foundation everything else consumes.
2. **Chunk 2 (parallelizable):** the six pages, applying the mapping table + hover/fade-up hookup.

Verification: `npm run build` and lint must pass after each chunk; then eyeball every page's empty state in the dev server (no real data exists yet, so empty states are exactly what the user will see first). Full visual QA with real data remains pending credential setup, tracked separately.

## Non-goals

- No max-width/centered layout (explicitly rejected in interview)
- No palette, font, or copy changes
- No page restructuring, no new components beyond the two token exports
- No full token refactor of the inline-hex convention (approach B was considered and rejected as too risky for a cosmetic goal)

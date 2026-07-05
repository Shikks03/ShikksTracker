# Comfortable Density Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale the entire UI from its current compact density to the approved "Comfortable" level (type +15–20%, roomier padding, 40px tiles), plus soft panel shadows, hover tints, and a gentle page fade-up — visual-only, no behavior changes.

**Architecture:** Approach C (hybrid) from the spec at `docs/superpowers/specs/2026-07-05-comfortable-density-redesign.md`: shared primitives in `src/components/ui.tsx` are updated first so everything flowing through them scales in one place; then a fixed old→new mapping (the tables below) is applied mechanically to the inline style objects in `Sidebar.tsx` and the six page files. No layout restructuring, full-bleed stays, palette/fonts stay.

**Tech Stack:** Next.js App Router + TypeScript, Tailwind v4 (`@theme` in globals.css), inline style objects with exact hexes (existing convention — keep it). No test framework exists; verification is `npm run build` + `npm run lint` + visual check of empty states.

---

## Global Mapping Tables

These tables are the single source of truth for every task below. Apply them **mechanically** — never invent values. If you meet a value not listed, multiply by 1.4 and round to the nearest even integer.

### Table F — `fontSize` (px → px)

| Old | New | | Old | New |
|---|---|---|---|---|
| 8 | 9 | | 13 | 14.5 |
| 8.5 | 9.5 | | 13.5 | 15.5 |
| 9 | 10 | | 14 | 16 |
| 9.5 | 10.5 | | 14.5 | 16.5 |
| 10 | 11 | | 15 | 17 |
| 10.5 | 11.5 | | 20 | 23 |
| 11 | 12 | | 24 | 28 |
| 11.5 | 12.5 | | 26 | 30 |
| 12 | 13 | | 27 | 31 |
| 12.5 | 14 | | 34 | 40 |
| — | — | | 38 | 44 |
| — | — | | 40 | 46 |

### Table G — `gap`, `marginTop`, `marginBottom`, `margin` numeric px values

| Old | New | | Old | New |
|---|---|---|---|---|
| 2 | 3 | | 12 | 16 |
| 4 | 6 | | 14 | 18 |
| 5 | 7 | | 16 | 22 |
| 6 | 8 | | 18 | 24 |
| 8 | 10 | | 20 | 28 |
| 10 | 14 | | 24 | 32 |
| — | — | | 26 | 36 |

Do **not** apply Table G to `height: 1` hairlines, `borderRadius`, `borderWidth`, `letterSpacing`, `lineHeight`, or fixed element `width`/`height` (tiles/avatars have their own explicit mappings in the tasks).

### Table P — `padding` strings (exact string → exact string)

| Old | New |
|---|---|
| `"1px 4px"` | `"2px 6px"` |
| `"1px 6px"` | `"2px 8px"` |
| `"2px 0"` | `"3px 0"` |
| `"4px 10px"` | `"6px 14px"` |
| `"5px 10px"` | `"7px 14px"` |
| `"5px 24px 5px 10px"` | `"7px 34px 7px 14px"` |
| `"8px"` | `"12px"` |
| `"8px 0 8px 8px"` | `"12px 0 12px 12px"` |
| `"8px 10px"` | `"12px 14px"` |
| `"8px 14px"` | `"12px 20px"` |
| `"9px 16px"` | `"12px 22px"` |
| `"10px 12px"` | `"14px 18px"` |
| `"10px 14px"` | `"14px 20px"` |
| `"10px 16px"` | `"14px 22px"` |
| `"11px 16px"` | `"16px 22px"` |
| `"12px 14px"` | `"16px 20px"` |
| `"12px 16px"` | `"16px 22px"` |
| `"13px 16px"` | `"18px 22px"` |
| `"14px 16px"` | `"20px 22px"` |
| `"14px 16px 20px"` | `"20px 22px 28px"` |
| `"14px 20px"` | `"20px 28px"` |
| `"16px 18px"` | `"22px 26px"` |
| `"16px 20px"` | `"22px 28px"` |
| `"18px 20px"` | `"26px 28px"` |
| `"20px 0"` | `"28px 0"` |
| `"20px 16px"` | `"28px 22px"` |
| `"20px 20px 0"` | `"28px 28px 0"` |
| `"22px 16px"` | `"28px 20px"` |
| `"22px 30px"` | `"30px 40px"` |
| `"22px 30px 40px"` | `"30px 40px 56px"` |
| `"24px 30px 40px"` | `"34px 42px 56px"` |
| `"32px 30px 60px"` | `"44px 42px 80px"` |
| `"36px 20px"` | `"50px 28px"` |
| `"40px 0"` | `"56px 0"` |
| `"80px 0"` | `"80px 0"` (unchanged — empty states are already generous) |

### Per-page boilerplate (referenced by Tasks 4–9 as "the page boilerplate")

Every page task also does these four things:

1. **Fade-up wrapper:** add `className="page-enter"` to the page's outermost content `<div>`/`<main>` (the one carrying the page padding). One per page, nothing staggered.
2. **Row hover:** add `className="row-hover"` to list rows / table rows / row-shaped `<Link>`s that navigate or are clickable. **Skip** rows that already have a non-default background (e.g. amber HOT tint `#F6ECCE`) — the hover rule uses `!important` and would fight them.
3. **Serif display titles:** page-title/greeting `fontSize` values follow Table F (34→40, 38→44, 40→46, 26→30, 27→31, 20→23).
4. **Panel shadows on page-local cards:** any page-local container styled like a panel (`backgroundColor: "#F8F5EC"` + hairline border) that does **not** use the `Panel` component gets `boxShadow: panelShadow` (import `panelShadow` from `@/components/ui`). Never add shadows to rows, chips, or anything inside a panel. Exception: the review page's focus card keeps its existing stronger shadow.

---

### Task 1: Update shared primitives in `ui.tsx`

**Files:**
- Modify: `src/components/ui.tsx`

- [ ] **Step 1: Apply these exact changes**

| Component | Change |
|---|---|
| `MonoLabel` | `fontSize: 10` → `11` |
| `Panel` | add `boxShadow: panelShadow,` to the style object (after `borderRadius: 10,`) |
| `InitialsTile` | default `size = 34` → `40`; `borderRadius: 6` → `7`; inner `fontSize: 11` → `12.5` |
| `HotChip` | `fontSize: 9.5` → `10.5`; `padding: "1px 5px"` → `"2px 7px"` |
| `PipelineMarker` | square `width/height: 7` → `8`; label `fontSize: 12.5` → `14`; container `gap: 5` → `6` |
| `SectionHeader` | title `fontSize: 10.5` → `11.5`; count chip `fontSize: 10` → `11` and `padding: "1px 5px"` → `"2px 7px"`; container `gap: 8` → `10` |

- [ ] **Step 2: Update the Button base string**

```ts
const base =
  "inline-flex items-center justify-center gap-1.5 rounded-[7px] text-[14.5px] px-[18px] py-[10px] transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
```

- [ ] **Step 3: Update the input class strings**

```ts
export const inputClass =
  "w-full bg-[#FCFAF3] border border-[#D3C9B4] rounded-[7px] font-sans text-[15px] text-[#1A1712] px-[14px] py-[10px] focus:border-[#A99E86] outline-none placeholder:text-[#A2957A] transition-colors duration-150";

export const monoInputClass =
  "w-full bg-[#FCFAF3] border border-[#D3C9B4] rounded-[7px] font-mono text-[12px] uppercase tracking-[0.08em] text-[#1A1712] px-[14px] py-[10px] focus:border-[#A99E86] outline-none placeholder:text-[#A2957A] transition-colors duration-150";
```

- [ ] **Step 4: Add the two new token exports** (top of file, after the `mono`/`grotesk` constants)

```ts
/** Soft warm-tinted shadow for panels/cards only — never rows or chips. */
export const panelShadow =
  "0 1px 2px rgba(26,23,18,0.04), 0 2px 6px rgba(26,23,18,0.05)";

/** Standard interactive transition. */
export const uiTransition =
  "background-color 130ms ease, border-color 130ms ease, box-shadow 130ms ease, color 130ms ease";
```

- [ ] **Step 5: Verify**

Run: `npm run build` then `npm run lint` — both must pass with no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui.tsx
git commit -m "Scale ui.tsx primitives to Comfortable density; add panelShadow/uiTransition tokens"
```

---

### Task 2: Motion + hover CSS in `globals.css`

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Append after the `.sidebar-nav-inactive:hover` rule**

```css
/* ── Comfortable density pass: motion + hover ─────────────── */

@keyframes fade-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}

/* One gentle entrance per page — applied to each page's outermost content wrapper. */
.page-enter {
  animation: fade-up 200ms ease-out;
}

/* Row hover tint — inline styles win on base state, so hover needs a class.
   Do not apply to rows with a non-default background (e.g. HOT amber). */
.row-hover {
  transition: background-color 130ms ease;
}
.row-hover:hover {
  background-color: #F1EBDD !important;
}

@media (prefers-reduced-motion: reduce) {
  .page-enter { animation: none; }
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "Add fade-up entrance and row-hover tint CSS"
```

---

### Task 3: Scale the sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Apply these exact changes** (top to bottom in the file)

| Element | Old | New |
|---|---|---|
| `<aside>` width/minWidth/maxWidth | 238 | 268 |
| `<aside>` padding | `"22px 16px"` | `"28px 20px"` |
| Wordmark `fontSize` | 24 | 28 |
| Sublabel (`TRACKER · OUTREACH OS`) `fontSize` / `marginTop` | 9.5 / 5 | 10.5 / 7 |
| Top divider `marginTop`/`marginBottom` | 18 / 18 | 24 / 24 |
| `<nav>` `gap` | 2 | 3 |
| Nav `<Link>` `gap` / `padding` | 8 / `"8px 10px"` | 10 / `"12px 14px"` |
| Mono index `fontSize` | 10 | 11 |
| Grotesk label `fontSize` | 13.5 | 15 |
| Draft badge `fontSize` / `padding` | 10 / `"1px 6px"` | 11 / `"2px 8px"` |
| Bottom divider `marginBottom` | 14 | 20 |
| `NEXT SEND` label `fontSize` / `marginBottom` | 9.5 / 5 | 10.5 / 7 |
| Countdown `fontSize` / `marginBottom` | 15 / 16 | 17 / 22 |
| User chip container `gap` | 8 | 10 |
| Avatar tile `width`/`height` / inner `fontSize` | 28 / 11 | 32 / 12 |
| Name `fontSize` | 13 | 14.5 |

Everything else (colors, `borderRadius`, `letterSpacing`, active/hover logic, badge fetch) unchanged.

- [ ] **Step 2: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "Scale sidebar to Comfortable density (268px rail)"
```

---

### Task 4: Dashboard page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `8`×3, `9.5`×1, `10`×7, `14`×3, `15`×1, `38`×2, `40`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"40px 0"`×2, `"14px 16px"`×2, `"5px 10px"`, `"16px 20px"`, `"5px 24px 5px 10px"`, `"24px 30px 40px"` (page padding), `"13px 16px"`.

- [ ] **Step 3: Apply Table G to every numeric `gap:`, `marginTop:`, `marginBottom:`** (skip hairlines/radii per Table G note).

- [ ] **Step 4: File-specific changes**
  - `<InitialsTile name={c.businessName} size={34}` → remove the `size={34}` prop (the new default is 40).
  - Apply the page boilerplate (`.page-enter` on the outermost wrapper, `.row-hover` on contact rows — **skip HOT-tinted rows** with `#F6ECCE` background).

- [ ] **Step 5: Verify no stragglers**

```powershell
Select-String -Path src/app/page.tsx -Pattern 'fontSize: (8|9\.5|10|13\.5|38|40),' | Measure-Object
```
Expected: 0 matches (note `fontSize: 14` legitimately becomes 16, and new values like 11 will appear — only old values must be gone).

- [ ] **Step 6: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "Scale dashboard to Comfortable density"
```

---

### Task 5: Review queue page

**Files:**
- Modify: `src/app/review/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `9`×2, `9.5`×6, `10`×4, `10.5`×1, `11`×1, `13`×1, `14.5`×2, `27`×2, `34`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"10px 12px"`×2, `"10px 14px"`, `"10px 16px"`, `"14px 20px"`, `"1px 4px"`, `"14px 16px 20px"`, `"20px 20px 0"`, `"80px 0"` (keep unchanged), `"12px 16px"`, `"24px 30px 40px"` (page padding), `"2px 0"`, `"1px 6px"`, `"16px 20px"`.

- [ ] **Step 3: Apply Table G to every numeric `gap:`/`marginTop:`/`marginBottom:`.**

- [ ] **Step 4: File-specific changes**
  - The **focus card keeps its existing stronger shadow** — do not replace it with `panelShadow`.
  - Apply the page boilerplate. Draft cards in the queue list count as rows for `.row-hover` if they're clickable.

- [ ] **Step 5: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/review/page.tsx
git commit -m "Scale review queue to Comfortable density"
```

---

### Task 6: Campaigns page

**Files:**
- Modify: `src/app/campaigns/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `9`×1, `9.5`×9, `10`×1, `11`×4, `13`×2, `20`×2, `34`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"40px 0"`×2, `"10px 16px"`×2, `"16px 20px"`×2, `"8px 0 8px 8px"`, `"18px 20px"`, `"24px 30px 40px"` (page padding).

- [ ] **Step 3: Apply Table G to every numeric `gap:`/`marginTop:`/`marginBottom:`.**

- [ ] **Step 4: Apply the page boilerplate** (`.page-enter` wrapper; `.row-hover` on campaign list rows if clickable).

- [ ] **Step 5: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/campaigns/page.tsx
git commit -m "Scale campaigns page to Comfortable density"
```

---

### Task 7: Import page

**Files:**
- Modify: `src/app/import/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `8.5`×1, `9`×1, `9.5`×7, `13`×2, `14`×1, `26`×1, `34`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"36px 20px"` (dropzone), `"14px 16px"`, `"32px 30px 60px"` (page padding), `"8px"`.

- [ ] **Step 3: Apply Table G to every numeric `gap:`/`marginTop:`/`marginBottom:`.**

- [ ] **Step 4: Apply the page boilerplate** (`.page-enter` wrapper; result tiles are not navigable rows — no `.row-hover` unless a row is clickable).

- [ ] **Step 5: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/import/page.tsx
git commit -m "Scale import page to Comfortable density"
```

---

### Task 8: Suppressions page

**Files:**
- Modify: `src/app/suppressions/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `9`×2, `9.5`×5, `10`×2, `11.5`×1, `12`×2, `34`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"20px 16px"`, `"10px 16px"`, `"9px 16px"`, `"11px 16px"`, `"12px 14px"`, `"24px 30px 40px"` (page padding), `"16px 20px"`, `"20px 0"`.

- [ ] **Step 3: Apply Table G to every numeric `gap:`/`marginTop:`/`marginBottom:`.**

- [ ] **Step 4: Apply the page boilerplate** (`.page-enter` wrapper; `.row-hover` on table rows only if they have a click action — suppression rows with just a delete button don't need it).

- [ ] **Step 5: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/suppressions/page.tsx
git commit -m "Scale suppressions page to Comfortable density"
```

---

### Task 9: Contact detail page

**Files:**
- Modify: `src/app/contacts/[id]/page.tsx`

- [ ] **Step 1: Apply Table F to every `fontSize:`** — expected occurrences: `9`×2, `9.5`×6, `10`×8, `11`×2, `13`×6, `13.5`×4, `26`×1.

- [ ] **Step 2: Apply Table P to every `padding:` string** — this file contains: `"22px 30px"`×3, `"16px 20px"`×2, `"22px 30px 40px"` (page padding), `"1px 6px"`, `"40px 0"`, `"12px 16px"`×2, `"4px 10px"`, `"16px 18px"`×2, `"8px 14px"`×2.

- [ ] **Step 3: Apply Table G to every numeric `gap:`/`marginTop:`/`marginBottom:`.**

- [ ] **Step 4: File-specific changes**
  - `<InitialsTile name={contact.businessName} size={48}` → `size={56}`.
  - Apply the page boilerplate (`.page-enter` wrapper; timeline/thread entries generally aren't navigable — `.row-hover` only on clickable rows).

- [ ] **Step 5: Verify** — `npm run build` and `npm run lint` pass.

- [ ] **Step 6: Commit** (note: quote the bracketed path)

```bash
git add "src/app/contacts/[id]/page.tsx"
git commit -m "Scale contact detail page to Comfortable density"
```

---

### Task 10: Final sweep + visual verification

**Files:**
- Modify: `SESSION_NOTES.md`

- [ ] **Step 1: Whole-app leftover scan** — from the project root:

```powershell
Get-ChildItem -Recurse -Filter *.tsx -Path src | ForEach-Object { Select-String -LiteralPath $_.FullName -Pattern 'fontSize: (8|8\.5|9|9\.5|13\.5)[,\s]' } 
```
Expected: 0 matches (all sub-10px and 13.5px type is gone). Investigate any hit before proceeding.

- [ ] **Step 2: Full build + lint**

Run: `npm run build` then `npm run lint`.
Expected: both pass with zero errors.

- [ ] **Step 3: Visual check of every page's empty state**

Run `npm run dev`, open `http://localhost:3000` and visit `/`, `/review`, `/campaigns`, `/import`, `/suppressions` (contact detail needs an id — skip if no data). Confirm: bigger type, roomier rows, soft panel shadows, sidebar 268px, fade-up on navigation, row hover tint. This is a human/orchestrator step — the implementer flags it done only after screenshots or explicit reviewer sign-off.

- [ ] **Step 4: Update SESSION_NOTES.md**

Append one line to the log noting: "Comfortable density pass applied app-wide (spec: docs/superpowers/specs/2026-07-05-comfortable-density-redesign.md) — visual QA with real data still pending credentials."

- [ ] **Step 5: Commit**

```bash
git add SESSION_NOTES.md
git commit -m "Complete Comfortable density pass; note in session log"
```

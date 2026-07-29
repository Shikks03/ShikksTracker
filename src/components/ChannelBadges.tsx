"use client";

/**
 * ChannelBadges.tsx — small uppercase pills for the multi-channel outreach
 * fields. Shared by the /outreach board and the contact detail page (they were
 * duplicated when both landed; consolidated here so the palettes can't drift).
 * Follows the StatusBadge.tsx pattern: inline styles + hex literals.
 */

import { mono, FAINT2 } from "@/components/tokens";
import { CHANNEL_META, TIER_LABELS, type Channel } from "@/lib/channels";

/** Shared pill geometry — identical across all three badges. */
const pillBase: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  borderRadius: 4,
  padding: "2px 8px",
  lineHeight: 1.6,
  flexShrink: 0,
};

export function ChannelBadge({ channel }: { channel: Channel }) {
  const meta = CHANNEL_META[channel];
  return (
    <span
      style={{
        ...pillBase,
        border: `1px solid ${meta.border}`,
        color: meta.text,
        backgroundColor: meta.bg,
      }}
    >
      {meta.label}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span style={{ ...pillBase, border: "1px solid #D8CFBB", color: FAINT2 }}>
      {TIER_LABELS[tier] ?? tier.toUpperCase()}
    </span>
  );
}

/** Unclaimed listings are a lead-quality signal worth chasing — call it out in amber, same as HotChip. */
export function ClaimedBadge({ claimed }: { claimed: string }) {
  const unclaimed = claimed === "unclaimed";
  return (
    <span
      style={{
        ...pillBase,
        border: `1px solid ${unclaimed ? "#D8B45E" : "#D8CFBB"}`,
        color: unclaimed ? "#8A6212" : FAINT2,
        backgroundColor: unclaimed ? "#F3E9CE" : "transparent",
      }}
    >
      {claimed.toUpperCase()}
    </span>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  type Toast,
} from "@/lib/toast";
import { grotesk, mono, INK, FAINT, CLAY, FOREST_ACTION } from "./tokens";

/**
 * Fixed overlay that renders the toast stack. Mounted once in the root layout,
 * so any page — and apiFetch itself — can surface a failure without owning a
 * banner. Bottom-right: the primary actions on the long pages (Send, Import,
 * Save) all sit low on the page, so that is where the eye already is.
 */

const ACCENT: Record<Toast["kind"], string> = {
  error: CLAY,
  success: FOREST_ACTION,
  info: FAINT,
};

export default function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);

  if (toasts.length === 0) return null;

  return (
    <div
      // polite, not assertive: these announce results of the user's own action.
      aria-live="polite"
      style={{
        position: "fixed",
        right: 24,
        bottom: 22,
        zIndex: 90,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: 380,
        maxWidth: "calc(100vw - 48px)",
        pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-enter"
          style={{
            pointerEvents: "auto",
            backgroundColor: "#F8F5EC",
            border: "1px solid #D3C9B4",
            borderLeft: `3px solid ${ACCENT[t.kind]}`,
            borderRadius: 8,
            boxShadow: "0 10px 30px -14px rgba(40,30,10,.55)",
            padding: "13px 14px 14px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: ACCENT[t.kind],
                marginBottom: 6,
              }}
            >
              {t.title}
            </div>
            <div
              style={{
                fontFamily: grotesk,
                fontSize: 14,
                lineHeight: 1.45,
                color: INK,
                // Server errors can be long single tokens (URLs, ids) — break
                // them rather than letting the card scroll sideways.
                overflowWrap: "anywhere",
                maxHeight: 220,
                overflowY: "auto",
              }}
            >
              {t.message}
            </div>
          </div>

          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              cursor: "pointer",
              color: FAINT,
              display: "inline-flex",
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";

/**
 * Returns the next UTC timestamp (ms) that is a top-of-the-hour falling
 * within the Manila send window: 08:00–18:00 Asia/Manila (UTC+8, no DST).
 *
 * "Next top-of-the-hour" means the earliest future HH:00:00 UTC such that
 * (UTCHour + 8) % 24 is in [8, 18].
 */
function getNextSendTarget(): number {
  const nowMs = Date.now();
  // Epoch hours are whole numbers; the next full UTC hour comes after the
  // current one (even if we are exactly on the hour).
  const nextHourMs = (Math.floor(nowMs / 3_600_000) + 1) * 3_600_000;

  for (let i = 0; i < 48; i++) {
    const candidateMs = nextHourMs + i * 3_600_000;
    const utcHour = Math.floor(candidateMs / 3_600_000) % 24;
    const manilaHour = (utcHour + 8) % 24;
    if (manilaHour >= 8 && manilaHour <= 18) {
      return candidateMs;
    }
  }

  // Fallback (should never be reached): return next hour.
  return nextHourMs;
}

/**
 * Reusable hook that returns a live "HH:MM:SS" countdown string targeting
 * the next send window slot. Returns "--:--:--" until mounted (SSR-safe).
 */
export function useNextSendCountdown(): string {
  const [display, setDisplay] = useState("--:--:--");

  useEffect(() => {
    function tick() {
      const target = getNextSendTarget();
      const diff = Math.max(0, target - Date.now());

      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);

      setDisplay(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    }

    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, []);

  return display;
}

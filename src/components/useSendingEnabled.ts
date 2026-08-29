"use client";
import { useEffect, useState } from "react";

/**
 * Client-side read of the engine-control switches (/settings, singleton
 * Settings doc). Only `sendingEnabled` is consumed today: it gates the
 * NEXT SEND countdown, because with cron sending switched off no automated
 * send happens at the next window slot and a ticking timer is simply a lie.
 *
 * Deliberately fetched on mount only — NOT on every route change like the
 * sidebar's draft badge. GET /api/settings runs getSettings(), which is an
 * upsert (see src/lib/settings.ts), so polling it would write to Mongo on
 * every navigation. Instead /settings dispatches SETTINGS_CHANGED_EVENT after
 * a successful toggle, so the persistent sidebar updates immediately without
 * a reload. Another tab/device won't see the change until reload — acceptable
 * for a single-user tool.
 */

/** Fired on `window` by /settings after a toggle persists. */
export const SETTINGS_CHANGED_EVENT = "shikks:settings-changed";

export interface SettingsSnapshot {
  draftGenerationEnabled: boolean;
  sendingEnabled: boolean;
}

export function emitSettingsChanged(settings: SettingsSnapshot): void {
  window.dispatchEvent(
    new CustomEvent<SettingsSnapshot>(SETTINGS_CHANGED_EVENT, { detail: settings })
  );
}

/**
 * Whether cron sending is ON. `null` means "not known yet" — the first fetch
 * is still in flight, or it failed. Callers must treat null as "don't show the
 * countdown": a missing timer is better than a wrong one, and it also avoids a
 * timer flashing on screen for one render before being hidden.
 */
export function useSendingEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Partial<SettingsSnapshot>;
        if (!cancelled && typeof data.sendingEnabled === "boolean") {
          setEnabled(data.sendingEnabled);
        }
      } catch {
        // network hiccup — stay unknown, which keeps the countdown hidden
      }
    }
    load();

    function onChanged(event: Event) {
      const detail = (event as CustomEvent<Partial<SettingsSnapshot>>).detail;
      if (typeof detail?.sendingEnabled === "boolean") {
        setEnabled(detail.sendingEnabled);
      }
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onChanged);
    };
  }, []);

  return enabled;
}

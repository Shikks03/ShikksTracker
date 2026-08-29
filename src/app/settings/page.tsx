"use client";

import { useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, CLAY } from "@/components/tokens";
import { apiFetch } from "@/lib/client";
import { emitSettingsChanged } from "@/components/useSendingEnabled";

interface Settings {
  draftGenerationEnabled: boolean;
  sendingEnabled: boolean;
}

type SettingsField = keyof Settings;

interface ToggleRowProps {
  label: string;
  caption: string;
  enabled: boolean;
  pending: boolean;
  last?: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, caption, enabled, pending, last, onToggle }: ToggleRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "18px 0",
        borderBottom: last ? "none" : "1px solid #E3DAC5",
      }}
    >
      <div>
        <div style={{ fontFamily: grotesk, fontSize: 17, color: INK, marginBottom: 4 }}>
          {label}
        </div>
        <div style={{ fontFamily: grotesk, fontSize: 13.5, color: FAINT, maxWidth: 420 }}>
          {caption}
        </div>
      </div>
      <Button
        variant={enabled ? "primary" : "outline"}
        onClick={onToggle}
        disabled={pending}
        style={{ minWidth: 76, flexShrink: 0 }}
      >
        {enabled ? "ON" : "OFF"}
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<SettingsField | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error: err } = await apiFetch<Settings>("/api/settings");
      if (cancelled) return;
      if (err) setError(err);
      else setSettings(data);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(field: SettingsField) {
    if (!settings || pendingField) return;
    setPendingField(field);
    setError(null);
    const { data, error: err } = await apiFetch<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ [field]: !settings[field] }),
    });
    setPendingField(null);
    if (err) {
      setError(err);
      return;
    }
    setSettings(data);
    // Tell already-mounted consumers (the persistent sidebar's NEXT SEND
    // countdown) so they don't keep showing stale state until a reload.
    if (data) emitSettingsChanged(data);
  }

  const anyPending = pendingField !== null;

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>
      <span
        style={{
          fontFamily: mono,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: FAINT,
          display: "block",
          marginBottom: 10,
        }}
      >
        ENGINE CONTROL
      </span>
      <h1
        style={{
          fontFamily: serif,
          fontSize: 40,
          fontWeight: 400,
          color: INK,
          letterSpacing: "-0.01em",
          margin: "0 0 28px",
          lineHeight: 1.1,
        }}
      >
        Settings
      </h1>

      {loading && (
        <div style={{ fontFamily: grotesk, color: FAINT }}>Loading…</div>
      )}

      {error && (
        <div
          style={{
            fontFamily: grotesk,
            fontSize: 14,
            color: CLAY,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {settings && (
        <Panel style={{ padding: "6px 24px", maxWidth: 640 }}>
          <ToggleRow
            label="Draft generation"
            caption="Cron will draft new outreach emails for contacts whose next send is due."
            enabled={settings.draftGenerationEnabled}
            pending={anyPending}
            onToggle={() => handleToggle("draftGenerationEnabled")}
          />
          <ToggleRow
            label="Sending"
            caption="Cron will send previously-approved drafts during the 8am–6pm Manila window. Manual sends (Review Queue, Compose) are not affected by this switch."
            enabled={settings.sendingEnabled}
            pending={anyPending}
            last
            onToggle={() => handleToggle("sendingEnabled")}
          />
        </Panel>
      )}
    </div>
  );
}

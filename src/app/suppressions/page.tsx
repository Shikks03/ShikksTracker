"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Panel, Button, inputClass, monoInputClass } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY } from "@/components/tokens";
import { apiFetch } from "@/lib/client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Suppression {
  _id:     string;
  email:   string;
  reason:  "unsubscribed" | "bounced" | "manual";
  addedAt: string;
}

const REASON_OPTIONS = ["unsubscribed", "bounced", "manual"] as const;
type Reason = typeof REASON_OPTIONS[number];

const REASON_META: Record<Reason, { squareColor: string; textColor: string; label: string }> = {
  unsubscribed: { squareColor: "#A23B28", textColor: "#A23B28", label: "UNSUBSCRIBED" },
  bounced:      { squareColor: "#C68A1E", textColor: "#96712A", label: "BOUNCED" },
  manual:       { squareColor: "#5B6472", textColor: "#5B6472", label: "MANUAL" },
};

function fmtDate(d: string): string {
  const dt  = new Date(d);
  const y   = dt.getFullYear();
  const m   = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SuppressionsPage() {
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [q,            setQ]            = useState("");

  // Add form
  const [addEmail,   setAddEmail]   = useState("");
  const [addReason,  setAddReason]  = useState<Reason>("manual");
  const [addLoading, setAddLoading] = useState(false);
  const [addError,   setAddError]   = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const { data, error: err } = await apiFetch<Suppression[]>(
      `/api/suppressions${params.toString() ? `?${params.toString()}` : ""}`
    );
    if (err) setError(err);
    else setSuppressions(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(""); }, [load]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => { load(q); }, 300);
    return () => clearTimeout(t);
  }, [q, load]);

  async function handleDelete(id: string, email: string) {
    const confirmed = window.confirm(
      `Unblock ${email}? They become contactable again.`
    );
    if (!confirmed) return;
    const { error: err } = await apiFetch(`/api/suppressions/${id}`, { method: "DELETE" });
    if (err) { setError(err); return; }
    setSuppressions((prev) => prev.filter((s) => s._id !== id));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);
    const { error: err } = await apiFetch("/api/suppressions", {
      method: "POST",
      body: JSON.stringify({ email: addEmail, reason: addReason }),
    });
    setAddLoading(false);
    if (err) { setAddError(err); return; }
    setAddEmail("");
    setAddReason("manual");
    load(q);
  }

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
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
            DO-NOT-CONTACT · PH DATA PRIVACY ACT
          </span>
          <h1
            style={{
              fontFamily: serif,
              fontSize: 40,
              fontWeight: 400,
              color: INK,
              letterSpacing: "-0.01em",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Blocked
          </h1>
        </div>

        {/* Search */}
        <div style={{ position: "relative", width: 220, marginTop: 6, flexShrink: 0 }}>
          <Search
            size={13}
            color={FAINT2}
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          />
          <input
            className={monoInputClass}
            style={{ paddingLeft: 36 }}
            placeholder="FILTER BY EMAIL…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Add row */}
      <div style={{ marginTop: 24 }}>
        <Panel style={{ padding: "16px 20px" }}>
          <form onSubmit={handleAdd} style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <input
              type="email"
              className={inputClass}
              style={{ flex: 1, fontFamily: mono, fontSize: 13 }}
              placeholder="email@to-block.ph"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              required
            />
            <select
              className={inputClass}
              style={{ width: 170, flexShrink: 0 }}
              value={addReason}
              onChange={(e) => setAddReason(e.target.value as Reason)}
            >
              <option value="manual">Reason: Manual</option>
              <option value="unsubscribed">Reason: Unsubscribed</option>
              <option value="bounced">Reason: Bounced</option>
            </select>
            <Button type="submit" variant="dark" disabled={addLoading} style={{ flexShrink: 0 }}>
              {addLoading ? "Blocking…" : "Block email"}
            </Button>
          </form>
          {addError && (
            <div style={{ marginTop: 10 }}>
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: CLAY,
                }}
              >
                {addError}
              </span>
            </div>
          )}
        </Panel>
      </div>

      {/* Table */}
      <div style={{ marginTop: 18 }}>
        {loading && (
          <span
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: FAINT,
              display: "block",
              padding: "28px 0",
            }}
          >
            LOADING…
          </span>
        )}
        {!loading && error && (
          <Panel style={{ padding: "22px 28px" }}>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: CLAY,
                textTransform: "uppercase",
              }}
            >
              {error}
            </span>
          </Panel>
        )}
        {!loading && !error && (
          <Panel style={{ padding: 0, overflow: "hidden" }}>
            {/* Header row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 1fr 1fr 90px",
                padding: "14px 22px",
                borderBottom: "1px solid #E4DBC8",
              }}
            >
              {["EMAIL", "REASON", "DATE ADDED", ""].map((col, i) => (
                <span
                  key={i}
                  style={{
                    fontFamily: mono,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: FAINT,
                    textAlign: i === 3 ? "right" : "left",
                  }}
                >
                  {col}
                </span>
              ))}
            </div>

            {/* Empty state */}
            {suppressions.length === 0 && (
              <div style={{ padding: "28px 22px", textAlign: "center" }}>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: FAINT,
                  }}
                >
                  NO BLOCKED EMAILS
                </span>
              </div>
            )}

            {/* Data rows */}
            {suppressions.map((s, idx) => {
              const meta = REASON_META[s.reason];
              return (
                <div key={s._id}>
                  {idx > 0 && <div style={{ height: 1, backgroundColor: "#E4DBC8" }} />}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 1fr 1fr 90px",
                      padding: "16px 22px",
                      alignItems: "center",
                    }}
                  >
                    {/* Email */}
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 12.5,
                        color: INK,
                      }}
                    >
                      {s.email}
                    </span>

                    {/* Reason */}
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.04em",
                        color: meta.textColor,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 1,
                          backgroundColor: meta.squareColor,
                          flexShrink: 0,
                        }}
                      />
                      {meta.label}
                    </span>

                    {/* Date */}
                    <span
                      style={{
                        fontFamily: mono,
                        fontSize: 11,
                        color: FAINT2,
                      }}
                    >
                      {fmtDate(s.addedAt)}
                    </span>

                    {/* Remove */}
                    <div style={{ textAlign: "right" }}>
                      <RemoveButton
                        onClick={() => handleDelete(s._id, s.email)}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Footer strip */}
            <div
              style={{
                borderTop: "1px solid #E4DBC8",
                backgroundColor: "#F1EBDD",
                padding: "12px 22px",
              }}
            >
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: FAINT,
                }}
              >
                {suppressions.length} BLOCKED · CHECKED ON EVERY IMPORT AND BEFORE EVERY SEND
              </span>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

// ── Remove button (isolated to avoid inline onMouseEnter casting) ──────────────

function RemoveButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: "var(--font-familjen)",
        fontSize: 13,
        color: hovered ? "#A23B28" : "#8E836C",
        textDecoration: hovered ? "underline" : "none",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "color 0.1s",
      }}
    >
      Remove
    </button>
  );
}

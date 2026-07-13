"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, Button, inputClass } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, FAINT2, CLAY, FOREST_ACTION as FOREST } from "@/components/tokens";
import { apiFetch } from "@/lib/client";

interface TemplateItem {
  _id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  // Editor state — editingId null = create mode, else edit mode
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name,      setName]      = useState("");
  const [subject,   setSubject]   = useState("");
  const [body,      setBody]      = useState("");
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // AI-generate state
  const [brief,      setBrief]      = useState("");
  const [tone,       setTone]       = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await apiFetch<TemplateItem[]>("/api/templates");
    setLoading(false);
    if (err) { setError(err); return; }
    setTemplates(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  function resetEditor() {
    setEditingId(null);
    setName(""); setSubject(""); setBody("");
    setBrief(""); setTone("");
    setSaveError(null); setGenError(null);
  }

  function startEdit(t: TemplateItem) {
    setEditingId(t._id);
    setName(t.name); setSubject(t.subject); setBody(t.body);
    setBrief(""); setTone("");
    setSaveError(null); setGenError(null);
    nameInputRef.current?.focus();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    const url = editingId ? `/api/templates/${editingId}` : "/api/templates";
    const method = editingId ? "PATCH" : "POST";
    const { error: err } = await apiFetch(url, {
      method,
      body: JSON.stringify({
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
      }),
    });
    setSaving(false);
    if (err) { setSaveError(err); return; }
    resetEditor();
    loadTemplates();
  }

  async function handleDelete(t: TemplateItem) {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    setDeletingId(t._id);
    const { error: err } = await apiFetch(`/api/templates/${t._id}`, { method: "DELETE" });
    setDeletingId(null);
    if (err) { setError(err); return; }
    if (editingId === t._id) resetEditor();
    loadTemplates();
  }

  async function handleGenerate() {
    if (!brief.trim()) { setGenError("Enter a brief first"); return; }
    setGenerating(true);
    setGenError(null);
    const { data, error: err } = await apiFetch<{ subject: string; body: string }>(
      "/api/templates/generate",
      { method: "POST", body: JSON.stringify({ brief: brief.trim(), tone: tone.trim() }) }
    );
    setGenerating(false);
    if (err || !data) { setGenError(err ?? "Generation failed"); return; }
    setSubject(data.subject);
    setBody(data.body);
  }

  const fieldLabel: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: FAINT2,
    display: "block",
    marginBottom: 7,
  };

  const errText: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: CLAY,
    display: "block",
    marginTop: 10,
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px" }}>

      {/* Header */}
      <span style={{ fontFamily: mono, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 10 }}>
        {templates.length} SAVED TEMPLATE{templates.length === 1 ? "" : "S"}
      </span>
      <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.01em", margin: "0 0 28px", lineHeight: 1.1 }}>
        Templates
      </h1>

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>

        {/* LEFT — list */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {loading && (
            <span style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, textAlign: "center", padding: "56px 0" }}>
              LOADING…
            </span>
          )}
          {!loading && error && (
            <Panel style={{ padding: "22px 28px" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: CLAY, textTransform: "uppercase" }}>{error}</span>
            </Panel>
          )}
          {!loading && !error && templates.length === 0 && (
            <span style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, textAlign: "center", padding: "56px 0" }}>
              NO TEMPLATES YET · CREATE ONE ON THE RIGHT
            </span>
          )}
          {templates.map((t) => (
            <Panel key={t._id} style={{ padding: "20px 26px", ...(editingId === t._id ? { borderColor: FOREST } : {}) }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontFamily: serif, fontSize: 22, color: INK, letterSpacing: "-0.01em" }}>{t.name}</span>
                <span style={{ fontFamily: mono, fontSize: 10, color: FAINT2, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {fmtDate(t.createdAt)}
                </span>
              </div>
              <div style={{ fontFamily: grotesk, fontSize: 15, color: "#2A251C", marginTop: 10 }}>{t.subject}</div>
              <div style={{ fontFamily: grotesk, fontSize: 13.5, color: FAINT2, marginTop: 6, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {t.body}
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 16 }}>
                <button type="button" onClick={() => startEdit(t)} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FOREST, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Edit
                </button>
                <button type="button" onClick={() => handleDelete(t)} disabled={deletingId === t._id} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: CLAY, background: "none", border: "none", cursor: deletingId === t._id ? "not-allowed" : "pointer", padding: 0 }}>
                  {deletingId === t._id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </Panel>
          ))}
        </div>

        {/* RIGHT — editor + AI generate */}
        <div style={{ width: 340, flexShrink: 0 }}>
          <Panel style={{ padding: "26px 28px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 style={{ fontFamily: serif, fontSize: 23, fontWeight: 400, color: INK, margin: 0, letterSpacing: "-0.01em" }}>
                {editingId ? "Edit template" : "New template"}
              </h2>
              {editingId && (
                <button type="button" onClick={resetEditor} style={{ fontFamily: mono, fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: FAINT, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  Cancel
                </button>
              )}
            </div>

            {/* AI generate block */}
            <div style={{ marginTop: 18, paddingBottom: 20, borderBottom: "1px solid #E4DBC8" }}>
              <label style={fieldLabel}>AI BRIEF <span style={{ color: "#96712A" }}>· OPTIONAL</span></label>
              <textarea
                className={inputClass}
                rows={2}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Friendly stage-1 intro for a bookkeeping service; mention a free consult"
                style={{ resize: "vertical" }}
              />
              <div style={{ marginTop: 12 }}>
                <label style={fieldLabel}>TONE</label>
                <input
                  className={inputClass}
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Warm, casual, Taglish-friendly"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerate}
                disabled={generating || !brief.trim()}
                className="w-full"
                style={{ marginTop: 14 }}
              >
                {generating ? "Generating…" : "Generate with AI"}
              </Button>
              {genError && <span style={errText}>{genError}</span>}
            </div>

            {/* Manual fields */}
            <form onSubmit={handleSave}>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>NAME</label>
                <input
                  ref={nameInputRef}
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bookkeeping intro"
                  required
                />
              </div>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>SUBJECT</label>
                <input
                  className={inputClass}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick question for {{businessName}}"
                  required
                />
              </div>
              <div style={{ marginTop: 18 }}>
                <label style={fieldLabel}>BODY</label>
                <textarea
                  className={inputClass}
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Hi {{contactName}}, …"
                  required
                  style={{ resize: "vertical" }}
                />
                <span style={{ fontFamily: mono, fontSize: 10, color: FAINT2, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 6, display: "block" }}>
                  {"TOKENS: {{businessName}} · {{contactName}}"}
                </span>
              </div>

              {saveError && <span style={errText}>{saveError}</span>}

              <Button type="submit" variant="primary" disabled={saving} className="w-full" style={{ marginTop: 22 }}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save template"}
              </Button>
            </form>
          </Panel>
        </div>
      </div>
    </div>
  );
}

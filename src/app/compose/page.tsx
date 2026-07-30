"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, Panel } from "@/components/ui";
import {
  serif, grotesk, mono, INK, FAINT, FAINT2, CLAY,
  FOREST_ACTION as FOREST,
} from "@/components/tokens";
import { apiFetch } from "@/lib/client";
import { isSubjectRequiredForChannels } from "@/lib/outreachLogs";

interface CampaignItem {
  _id: string;
  name: string;
}

interface ContactItem {
  _id: string;
  businessName: string;
  contactEmail: string;
  contactName?: string;
  currentStage: number;
  outreachChannel?: string;
}

interface BatchResult {
  created: number;
  skipped: { businessName: string; reason: string }[];
}

interface TemplateItem {
  _id: string;
  name: string;
  subject: string;
  body: string;
}

export default function ComposePage() {
  const router = useRouter();

  const [campaigns,        setCampaigns]        = useState<CampaignItem[]>([]);
  const [campaignId,       setCampaignId]       = useState("");
  const [contacts,         setContacts]         = useState<ContactItem[]>([]);
  const [repliedContacts,  setRepliedContacts]  = useState<ContactItem[]>([]);
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set());
  const [subject,     setSubject]     = useState("");
  const [body,        setBody]        = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [apiError,    setApiError]    = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result,      setResult]      = useState<BatchResult | null>(null);

  // Templates
  const [templates,   setTemplates]   = useState<TemplateItem[]>([]);
  const [templateId,  setTemplateId]  = useState("");
  const [savingTpl,   setSavingTpl]   = useState(false);

  const loadTemplates = useCallback(() => {
    apiFetch<TemplateItem[]>("/api/templates").then(({ data }) => {
      if (Array.isArray(data)) setTemplates(data);
    });
  }, []);

  // Load campaigns + templates once
  useEffect(() => {
    apiFetch<CampaignItem[]>("/api/campaigns").then(({ data, error }) => {
      if (Array.isArray(data)) setCampaigns(data);
      else if (error) setApiError(`Couldn't load campaigns — ${error}`);
    });
    loadTemplates();
  }, [loadTemplates]);

  function handleCampaignChange(id: string) {
    setCampaignId(id);
    setCheckedIds(new Set());
    setContacts([]);
    setRepliedContacts([]);
    setResult(null);
    setFieldErrors({});
    setApiError(null);
    if (!id) return;

    apiFetch<ContactItem[]>(`/api/contacts?campaignId=${id}&status=active`).then(
      ({ data, error }) => {
        if (Array.isArray(data)) {
          const sorted = [...data].sort((a, b) =>
            a.businessName.localeCompare(b.businessName)
          );
          setContacts(sorted);
        } else if (error) {
          setApiError(`Couldn't load contacts — ${error}`);
        }
      }
    );

    apiFetch<ContactItem[]>(`/api/contacts?campaignId=${id}&status=replied`).then(
      ({ data, error }) => {
        if (Array.isArray(data)) {
          const sorted = [...data].sort((a, b) =>
            a.businessName.localeCompare(b.businessName)
          );
          setRepliedContacts(sorted);
        } else if (error) {
          setApiError(`Couldn't load replied contacts — ${error}`);
        }
      }
    );
  }

  function toggleContact(id: string, on: boolean) {
    const next = new Set(checkedIds);
    if (on) next.add(id);
    else next.delete(id);
    setCheckedIds(next);
  }

  const allChecked = contacts.length > 0 && checkedIds.size === contacts.length;

  // Only `contacts` (active, checkable) recipients can be checked —
  // `repliedContacts` checkboxes are disabled — so this is the full set of
  // channels the batch will actually contain. A subject is required only if
  // at least one checked recipient is on the email channel (legacy null/
  // undefined channel counts as email — see isSubjectRequiredForChannel).
  const checkedChannels = contacts
    .filter((c) => checkedIds.has(c._id))
    .map((c) => c.outreachChannel);
  const subjectRequired = isSubjectRequiredForChannels(checkedChannels);

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(contacts.map((c) => c._id)));
  }

  function handleTemplateSelect(id: string) {
    setTemplateId(id);
    if (!id) return;
    const tpl = templates.find((t) => t._id === id);
    if (tpl) {
      setSubject(tpl.subject);
      setBody(tpl.body);
      // Clear any lingering field errors on those fields
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.subject;
        delete next.body;
        return next;
      });
    }
  }

  async function handleSaveAsTemplate() {
    const tplName = window.prompt("Template name:");
    if (!tplName || !tplName.trim()) return;
    setSavingTpl(true);
    setApiError(null);
    const { error } = await apiFetch("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name:    tplName.trim(),
        subject: subject.trim(),
        body:    body.trim(),
      }),
    });
    setSavingTpl(false);
    if (error) {
      setApiError(`Couldn't save template — ${error}`);
    } else {
      loadTemplates();
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!campaignId)          errs.campaign = "Select a campaign";
    if (checkedIds.size === 0) errs.recipients = "Select at least one recipient";
    if (subjectRequired && !subject.trim()) errs.subject = "Subject is required";
    if (!body.trim())         errs.body = "Body is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setApiError(null);
    setResult(null);

    try {
      const res = await fetch("/api/email-logs/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIds: Array.from(checkedIds),
          subject: subject.trim(),
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as BatchResult;
      setResult(data);
      // Clear the form so it can't be accidentally re-sent; keep campaign + result.
      setCheckedIds(new Set());
      setSubject("");
      setBody("");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    color: FAINT,
    textTransform: "uppercase",
    letterSpacing: "0.10em",
    display: "block",
    marginBottom: 8,
  };

  const fieldErrorStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10.5,
    color: CLAY,
    marginTop: 4,
    display: "block",
  };

  const noteStyle: React.CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    color: FAINT2,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginTop: 6,
    display: "block",
  };

  return (
    <div className="page-enter" style={{ padding: "34px 42px 56px", minHeight: "100%" }}>

      {/* Header */}
      <MonoLabel style={{ fontSize: 11, letterSpacing: "0.14em", color: FAINT, display: "block", marginBottom: 10 }}>
        MANUAL COMPOSE
      </MonoLabel>
      <h1 style={{ fontFamily: serif, fontSize: 40, fontWeight: 400, color: INK, letterSpacing: "-0.01em", lineHeight: 1.1, margin: "0 0 28px" }}>
        Compose
      </h1>

      <div style={{ maxWidth: 620 }}>
        <form onSubmit={handleSubmit}>
          <Panel style={{ padding: 28 }}>

            {/* Campaign */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Campaign</label>
              <select
                value={campaignId}
                onChange={(e) => handleCampaignChange(e.target.value)}
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  color: campaignId ? INK : FAINT,
                  backgroundColor: "#F8F5EC",
                  border: `1px solid ${fieldErrors.campaign ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">Select a campaign…</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
              {fieldErrors.campaign && <span style={fieldErrorStyle}>{fieldErrors.campaign}</span>}
            </div>

            {/* Recipients */}
            {campaignId && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>
                    Recipients · {checkedIds.size} selected
                  </label>
                  {contacts.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleAll}
                      style={{
                        fontFamily: mono,
                        fontSize: 10.5,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: FOREST,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {allChecked ? "Clear" : "Select all"}
                    </button>
                  )}
                </div>

                {contacts.length === 0 && repliedContacts.length === 0 ? (
                  <div style={{
                    fontFamily: mono, fontSize: 10.5, color: FAINT2,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    padding: "14px 0",
                  }}>
                    NO ACTIVE CONTACTS IN THIS CAMPAIGN
                  </div>
                ) : (
                  <div style={{
                    border: `1px solid ${fieldErrors.recipients ? CLAY : "#C9BEA6"}`,
                    borderRadius: 6,
                    maxHeight: 260,
                    overflowY: "auto",
                    backgroundColor: "#F8F5EC",
                  }}>
                    {contacts.map((c, idx) => (
                      <label
                        key={c._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          borderTop: idx > 0 ? "1px solid #E4DBC8" : "none",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checkedIds.has(c._id)}
                          onChange={(e) => toggleContact(c._id, e.target.checked)}
                          style={{ width: 15, height: 15, accentColor: FOREST, flexShrink: 0, cursor: "pointer" }}
                        />
                        <span style={{ fontFamily: grotesk, fontSize: 14.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.businessName}
                          <span style={{ color: FAINT2 }}> ({c.contactEmail})</span>
                        </span>
                      </label>
                    ))}
                    {contacts.length === 0 && repliedContacts.length > 0 && (
                      <div style={{
                        fontFamily: mono, fontSize: 10.5, color: FAINT2,
                        textTransform: "uppercase", letterSpacing: "0.06em",
                        padding: "10px 14px",
                      }}>
                        NO ACTIVE CONTACTS
                      </div>
                    )}
                    {repliedContacts.map((c, idx) => (
                      <div
                        key={c._id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 14px",
                          borderTop: (contacts.length > 0 || idx > 0) ? "1px solid #E4DBC8" : "none",
                          cursor: "default",
                          opacity: 0.45,
                        }}
                      >
                        <input
                          type="checkbox"
                          disabled
                          checked={false}
                          style={{ width: 15, height: 15, flexShrink: 0, cursor: "not-allowed" }}
                        />
                        <span style={{ fontFamily: grotesk, fontSize: 14.5, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {c.businessName}
                          <span style={{ color: FAINT2 }}> ({c.contactEmail})</span>
                        </span>
                        <span style={{
                          fontFamily: mono,
                          fontSize: 10,
                          color: CLAY,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}>
                          REPLIED — TAKE OVER PERSONALLY
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {fieldErrors.recipients && <span style={fieldErrorStyle}>{fieldErrors.recipients}</span>}
                <span style={noteStyle}>STAGE AUTO-ASSIGNED PER CONTACT (NEXT TOUCH)</span>
              </div>
            )}

            {/* Template picker */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Template</label>
              <select
                value={templateId}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  color: templateId ? INK : FAINT,
                  backgroundColor: "#F8F5EC",
                  border: "1px solid #C9BEA6",
                  borderRadius: 6,
                  padding: "10px 14px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">— Template —</option>
                {templates.map((t) => (
                  <option key={t._id} value={t._id}>{t.name}</option>
                ))}
              </select>
              <span style={noteStyle}>SELECTING A TEMPLATE PRE-FILLS SUBJECT + BODY (BOTH REMAIN EDITABLE)</span>
            </div>

            {/* Subject */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>
                Subject{!subjectRequired && " (optional — no email recipients selected)"}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject…"
                style={{
                  fontFamily: serif,
                  fontSize: 22,
                  fontWeight: 400,
                  color: INK,
                  letterSpacing: "-0.01em",
                  backgroundColor: "transparent",
                  border: "none",
                  borderBottom: `1px solid ${fieldErrors.subject ? CLAY : "#C9BEA6"}`,
                  outline: "none",
                  width: "100%",
                  padding: "3px 0",
                  lineHeight: 1.3,
                }}
              />
              {fieldErrors.subject && <span style={fieldErrorStyle}>{fieldErrors.subject}</span>}
            </div>

            {/* Body */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your email…"
                style={{
                  fontFamily: grotesk,
                  fontSize: 16.5,
                  lineHeight: 1.75,
                  color: "#2A251C",
                  backgroundColor: "transparent",
                  border: `1px solid ${fieldErrors.body ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  outline: "none",
                  width: "100%",
                  minHeight: 260,
                  padding: "14px 18px",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
              {fieldErrors.body && <span style={fieldErrorStyle}>{fieldErrors.body}</span>}
              <span style={noteStyle}>{"TOKENS: {{businessName}} · {{contactName}}"}</span>

              {/* Save as template */}
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleSaveAsTemplate}
                  disabled={savingTpl || !subject.trim() || !body.trim()}
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: (!subject.trim() || !body.trim() || savingTpl) ? FAINT2 : FOREST,
                    background: "none",
                    border: "none",
                    cursor: (!subject.trim() || !body.trim() || savingTpl) ? "not-allowed" : "pointer",
                    padding: 0,
                  }}
                >
                  {savingTpl ? "Saving…" : "Save as template"}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              style={{ width: "100%", marginTop: 18 }}
              disabled={submitting || checkedIds.size === 0}
            >
              {submitting
                ? "Queuing…"
                : `Queue ${checkedIds.size} email${checkedIds.size === 1 ? "" : "s"} for send`}
            </Button>

          </Panel>
        </form>

        {/* API error */}
        {apiError && (
          <Panel style={{ padding: "16px 22px", marginTop: 16 }}>
            <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>
              {apiError}
            </MonoLabel>
          </Panel>
        )}

        {/* Result summary */}
        {result && (
          <Panel style={{ padding: "20px 22px", marginTop: 16 }}>
            <MonoLabel style={{ fontSize: 12, letterSpacing: "0.10em", color: FOREST, display: "block" }}>
              QUEUED {result.created}
              {result.skipped.length > 0 && (
                <span style={{ color: CLAY }}> · SKIPPED {result.skipped.length}</span>
              )}
            </MonoLabel>

            {result.skipped.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {result.skipped.map((s, i) => (
                  <div key={i} style={{ fontFamily: mono, fontSize: 11, color: CLAY, marginTop: 4 }}>
                    {s.businessName} — {s.reason}
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              style={{ marginTop: 18 }}
              onClick={() => router.push("/review")}
            >
              Go to Review Queue
            </Button>
          </Panel>
        )}
      </div>
    </div>
  );
}

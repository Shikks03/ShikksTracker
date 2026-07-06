"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, Panel } from "@/components/ui";

const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

const INK    = "#1A1712";
const FAINT  = "#8E836C";
const FAINT2 = "#9A8F76";
const CLAY   = "#BC5228";
const FOREST = "#1C4B3A";

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
}

interface BatchResult {
  created: number;
  skipped: { businessName: string; reason: string }[];
}

export default function ComposePage() {
  const router = useRouter();

  const [campaigns,   setCampaigns]   = useState<CampaignItem[]>([]);
  const [campaignId,  setCampaignId]  = useState("");
  const [contacts,    setContacts]    = useState<ContactItem[]>([]);
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set());
  const [subject,     setSubject]     = useState("");
  const [body,        setBody]        = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [apiError,    setApiError]    = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result,      setResult]      = useState<BatchResult | null>(null);

  // Load campaigns once
  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setCampaigns(data as CampaignItem[]);
      })
      .catch(() => {});
  }, []);

  function handleCampaignChange(id: string) {
    setCampaignId(id);
    setCheckedIds(new Set());
    setContacts([]);
    setResult(null);
    setFieldErrors({});
    setApiError(null);
    if (!id) return;

    fetch(`/api/contacts?campaignId=${id}&status=active`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const sorted = (data as ContactItem[]).sort((a, b) =>
            a.businessName.localeCompare(b.businessName)
          );
          setContacts(sorted);
        }
      })
      .catch(() => {});
  }

  function toggleContact(id: string, on: boolean) {
    const next = new Set(checkedIds);
    if (on) next.add(id);
    else next.delete(id);
    setCheckedIds(next);
  }

  const allChecked = contacts.length > 0 && checkedIds.size === contacts.length;

  function toggleAll() {
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(contacts.map((c) => c._id)));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!campaignId)          errs.campaign = "Select a campaign";
    if (checkedIds.size === 0) errs.recipients = "Select at least one recipient";
    if (!subject.trim())      errs.subject = "Subject is required";
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

                {contacts.length === 0 ? (
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
                    maxHeight: 220,
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
                  </div>
                )}
                {fieldErrors.recipients && <span style={fieldErrorStyle}>{fieldErrors.recipients}</span>}
                <span style={noteStyle}>STAGE AUTO-ASSIGNED PER CONTACT (NEXT TOUCH)</span>
              </div>
            )}

            {/* Subject */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Subject</label>
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

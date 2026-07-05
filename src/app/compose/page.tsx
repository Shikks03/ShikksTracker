"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, MonoLabel, Panel } from "@/components/ui";

const serif   = "var(--font-instrument-serif)";
const grotesk = "var(--font-familjen)";
const mono    = "var(--font-jetbrains)";

const INK   = "#1A1712";
const FAINT = "#8E836C";
const CLAY  = "#BC5228";
const FOREST = "#1C4B3A";

interface ContactItem {
  _id: string;
  businessName: string;
  contactEmail: string;
  currentStage: number;
}

export default function ComposePage() {
  const router = useRouter();

  const [contacts, setContacts]       = useState<ContactItem[]>([]);
  const [contactId, setContactId]     = useState("");
  const [stage, setStage]             = useState<1 | 2 | 3 | null>(null);
  const [subject, setSubject]         = useState("");
  const [body, setBody]               = useState("");
  const [submitting, setSubmitting]   = useState(false);
  const [apiError, setApiError]       = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/contacts?status=active")
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
  }, []);

  function handleContactChange(id: string) {
    setContactId(id);
    const c = contacts.find((c) => c._id === id);
    if (c) {
      setStage((Math.min(c.currentStage + 1, 3)) as 1 | 2 | 3);
    } else {
      setStage(null);
    }
    setFieldErrors({});
    setApiError(null);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!contactId)       errs.contact = "Select a contact";
    if (!stage)           errs.stage   = "Select a stage";
    if (!subject.trim())  errs.subject = "Subject is required";
    if (!body.trim())     errs.body    = "Body is required";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    setApiError(null);

    try {
      const res = await fetch("/api/email-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId,
          stage,
          subject: subject.trim(),
          body: body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      router.push("/review");
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
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

            {/* Contact */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Contact</label>
              <select
                value={contactId}
                onChange={(e) => handleContactChange(e.target.value)}
                style={{
                  fontFamily: grotesk,
                  fontSize: 15,
                  color: contactId ? INK : FAINT,
                  backgroundColor: "#F8F5EC",
                  border: `1px solid ${fieldErrors.contact ? CLAY : "#C9BEA6"}`,
                  borderRadius: 6,
                  padding: "10px 14px",
                  width: "100%",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                <option value="">Select a contact…</option>
                {contacts.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.businessName} ({c.contactEmail})
                  </option>
                ))}
              </select>
              {fieldErrors.contact && <span style={fieldErrorStyle}>{fieldErrors.contact}</span>}
            </div>

            {/* Stage */}
            <div style={{ marginBottom: 22 }}>
              <label style={labelStyle}>Stage</label>
              <div style={{ display: "flex", gap: 10 }}>
                {([1, 2, 3] as const).map((s) => {
                  const active = stage === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setStage(s)}
                      style={{
                        fontFamily: mono,
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        padding: "8px 18px",
                        borderRadius: 6,
                        border: `1px solid ${active ? FOREST : "#C9BEA6"}`,
                        backgroundColor: active ? FOREST : "transparent",
                        color: active ? "#F4EEDF" : FAINT,
                        cursor: "pointer",
                        transition: "all 130ms ease",
                      }}
                    >
                      {s === 1 ? "1ST" : s === 2 ? "2ND" : "3RD"}
                    </button>
                  );
                })}
              </div>
              {fieldErrors.stage && <span style={fieldErrorStyle}>{fieldErrors.stage}</span>}
            </div>

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
            <div style={{ marginBottom: 28 }}>
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
            </div>

            <Button
              type="submit"
              variant="primary"
              style={{ width: "100%" }}
              disabled={submitting}
            >
              {submitting ? "Queuing…" : "Queue for send"}
            </Button>

          </Panel>
        </form>

        {apiError && (
          <Panel style={{ padding: "16px 22px", marginTop: 16 }}>
            <MonoLabel style={{ color: CLAY, textTransform: "uppercase" }}>
              {apiError}
            </MonoLabel>
          </Panel>
        )}
      </div>
    </div>
  );
}

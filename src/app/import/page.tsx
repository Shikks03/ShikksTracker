"use client";

import { useEffect, useRef, useState } from "react";

interface Campaign {
  _id: string;
  name: string;
}

const LEAD_SOURCES = [
  { value: "cold_email", label: "Cold Email" },
  { value: "referral", label: "Referral" },
  { value: "event_connection", label: "Event Connection" },
  { value: "other", label: "Other" },
] as const;

export default function ImportPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [csvResult, setCsvResult] = useState<unknown>(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const [manualResult, setManualResult] = useState<unknown>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual form state
  const [businessName, setBusinessName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [keyPoints, setKeyPoints] = useState("");
  const [leadSource, setLeadSource] = useState("cold_email");

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: Campaign[]) => {
        setCampaigns(data);
        if (data.length > 0) setCampaignId(data[0]._id);
      })
      .catch((err) => console.error("Failed to load campaigns", err));
  }, []);

  async function handleCsvUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setCsvResult({ error: "No file selected" });
      return;
    }
    if (!campaignId) {
      setCsvResult({ error: "No campaign selected" });
      return;
    }
    setCsvLoading(true);
    setCsvResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("campaignId", campaignId);
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setCsvResult(data);
    } catch (err) {
      setCsvResult({ error: String(err) });
    } finally {
      setCsvLoading(false);
    }
  }

  async function handleManualAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!campaignId) {
      setManualResult({ error: "No campaign selected" });
      return;
    }
    setManualLoading(true);
    setManualResult(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          contactEmail,
          contactName: contactName || undefined,
          keyPoints,
          leadSource,
          campaignId,
        }),
      });
      const data = await res.json();
      setManualResult(data);
      if (res.ok) {
        // Clear form on success
        setBusinessName("");
        setContactEmail("");
        setContactName("");
        setKeyPoints("");
        setLeadSource("cold_email");
      }
    } catch (err) {
      setManualResult({ error: String(err) });
    } finally {
      setManualLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-xl font-bold">Contact Import</h1>

      {/* Campaign selector (shared by both forms) */}
      <div className="space-y-1">
        <label className="block font-medium">Campaign</label>
        <select
          className="border p-1"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          {campaigns.length === 0 && (
            <option value="">Loading campaigns…</option>
          )}
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* ── CSV Upload ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">CSV Upload</h2>
        <p className="text-sm text-gray-600">
          Required columns: <code>businessName</code>, <code>contactEmail</code>,{" "}
          <code>keyPoints</code>. Optional: <code>contactName</code>,{" "}
          <code>leadSource</code> (cold_email | referral | event_connection | other).
        </p>
        <form onSubmit={handleCsvUpload} className="space-y-2">
          <div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" />
          </div>
          <button
            type="submit"
            disabled={csvLoading}
            className="border px-3 py-1"
          >
            {csvLoading ? "Uploading…" : "Upload CSV"}
          </button>
        </form>
        {csvResult !== null && (
          <pre className="bg-gray-100 p-3 text-sm overflow-auto">
            {JSON.stringify(csvResult, null, 2)}
          </pre>
        )}
      </section>

      {/* ── Manual Add ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Manual Add</h2>
        <form onSubmit={handleManualAdd} className="space-y-2">
          <div className="space-y-1">
            <label className="block text-sm">Business Name *</label>
            <input
              className="border p-1 w-full"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Contact Email *</label>
            <input
              type="email"
              className="border p-1 w-full"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Contact Name</label>
            <input
              className="border p-1 w-full"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Key Points *</label>
            <textarea
              className="border p-1 w-full"
              rows={3}
              value={keyPoints}
              onChange={(e) => setKeyPoints(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm">Lead Source</label>
            <select
              className="border p-1"
              value={leadSource}
              onChange={(e) => setLeadSource(e.target.value)}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={manualLoading}
            className="border px-3 py-1"
          >
            {manualLoading ? "Adding…" : "Add Contact"}
          </button>
        </form>
        {manualResult !== null && (
          <pre className="bg-gray-100 p-3 text-sm overflow-auto">
            {JSON.stringify(manualResult, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}

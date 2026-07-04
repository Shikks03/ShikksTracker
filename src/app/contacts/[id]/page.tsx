"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

// ---- Types ----

interface Contact {
  _id: string;
  businessName: string;
  contactName?: string;
  contactEmail: string;
  leadSource: string;
  keyPoints: string;
  status: string;
  pipelineStage: string;
  currentStage: number;
  engagementScore: number;
  nextSendAt: string | null;
  createdAt: string;
}

interface EmailLog {
  _id: string;
  stage: 1 | 2 | 3;
  status: string;
  subject: string;
  sentAt: string | null;
  openCount: number;
  clickCount: number;
  replied: boolean;
  repliedAt: string | null;
}

const PIPELINE_STAGES = [
  "not_started",
  "contacted",
  "replied",
  "call_booked",
  "proposal_sent",
  "won",
  "lost",
] as const;

const PIPELINE_LABELS: Record<string, string> = {
  not_started: "Not started",
  contacted: "Contacted",
  replied: "Replied",
  call_booked: "Call booked",
  proposal_sent: "Proposal sent",
  won: "Won",
  lost: "Lost",
};

const LEAD_SOURCE_LABELS: Record<string, string> = {
  cold_email: "Cold email",
  referral: "Referral",
  event_connection: "Event connection",
  other: "Other",
};

const EDITABLE_STATUSES = ["active", "paused"];

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { data: null, error: body.error ?? `HTTP ${res.status}` };
    }
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- Page ----

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [contact, setContact] = useState<Contact | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Editable state
  const [keyPoints, setKeyPoints] = useState("");
  const [savingKeyPoints, setSavingKeyPoints] = useState(false);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [contactRes, logsRes] = await Promise.all([
      apiFetch<Contact>(`/api/contacts/${id}`),
      apiFetch<EmailLog[]>(`/api/email-logs?contactId=${id}`),
    ]);
    if (contactRes.error) { setError(contactRes.error); setLoading(false); return; }
    if (contactRes.data) {
      setContact(contactRes.data);
      setKeyPoints(contactRes.data.keyPoints);
    }
    if (logsRes.data) {
      setLogs([...logsRes.data].sort((a, b) => a.stage - b.stage));
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patchContact(fields: Record<string, unknown>) {
    const { data, error } = await apiFetch<Contact>(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
    if (error) { setSaveMsg(`Error: ${error}`); return; }
    if (data) { setContact(data); setKeyPoints(data.keyPoints); }
    setSaveMsg("Saved.");
    setTimeout(() => setSaveMsg(null), 2000);
  }

  async function handlePipelineChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSavingPipeline(true);
    await patchContact({ pipelineStage: e.target.value });
    setSavingPipeline(false);
  }

  async function handleStatusChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSavingStatus(true);
    await patchContact({ status: e.target.value });
    setSavingStatus(false);
  }

  async function handleSaveKeyPoints() {
    setSavingKeyPoints(true);
    await patchContact({ keyPoints });
    setSavingKeyPoints(false);
  }

  if (loading) return <main className="p-6 text-gray-500">Loading&hellip;</main>;
  if (error) return <main className="p-6 text-red-600">Error: {error}</main>;
  if (!contact) return <main className="p-6 text-gray-500">Not found.</main>;

  const canEditStatus = EDITABLE_STATUSES.includes(contact.status);

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      {/* Back link */}
      <button
        onClick={() => router.push("/")}
        className="text-sm text-gray-500 hover:text-gray-800"
      >
        &larr; Back to contacts
      </button>

      {/* Header */}
      <section className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{contact.businessName}</h1>
            {contact.contactName && (
              <p className="text-gray-600 mt-0.5">{contact.contactName}</p>
            )}
            <p className="text-gray-500 text-sm mt-1">{contact.contactEmail}</p>
          </div>
          <div className="text-right space-y-1">
            <div>
              <span className="text-xs text-gray-500 mr-1">Score</span>
              <span className={
                contact.engagementScore >= 5
                  ? "font-bold text-orange-600"
                  : "font-medium text-gray-800"
              }>
                {contact.engagementScore}
              </span>
            </div>
            <div>
              <span className="text-xs text-gray-500 mr-1">Lead source</span>
              <span className="text-sm text-gray-700">
                {LEAD_SOURCE_LABELS[contact.leadSource] ?? contact.leadSource}
              </span>
            </div>
            <StatusBadge value={contact.status} />
          </div>
        </div>
      </section>

      {/* Controls */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">Pipeline controls</h2>

        {saveMsg && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5">
            {saveMsg}
          </p>
        )}

        <div className="flex flex-wrap gap-6 items-end">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Pipeline stage</label>
            <select
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={contact.pipelineStage}
              onChange={handlePipelineChange}
              disabled={savingPipeline}
            >
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>{PIPELINE_LABELS[s]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Status</label>
            {canEditStatus ? (
              <select
                className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={contact.status}
                onChange={handleStatusChange}
                disabled={savingStatus}
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
              </select>
            ) : (
              <div className="py-1">
                <StatusBadge value={contact.status} />
                <p className="text-xs text-gray-400 mt-1">System-set &mdash; read only</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Key points */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
        <h2 className="font-semibold text-gray-800">Key points</h2>
        <textarea
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          rows={5}
          value={keyPoints}
          onChange={(e) => setKeyPoints(e.target.value)}
        />
        <button
          onClick={handleSaveKeyPoints}
          disabled={savingKeyPoints || keyPoints === contact.keyPoints}
          className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 transition-colors"
        >
          {savingKeyPoints ? "Saving…" : "Save key points"}
        </button>
      </section>

      {/* Email log timeline */}
      <section className="space-y-3">
        <h2 className="font-semibold text-gray-800">Email timeline</h2>
        {logs.length === 0 && (
          <p className="text-gray-400 text-sm">No email logs yet.</p>
        )}
        {logs.map((log) => (
          <div key={log._id} className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs text-gray-500 font-medium mr-2">Stage {log.stage}</span>
                <StatusBadge value={log.status} />
                <p className="text-sm font-medium text-gray-800 mt-1">{log.subject}</p>
              </div>
              <div className="text-right text-xs text-gray-500 shrink-0">
                <div>Sent: {formatDate(log.sentAt)}</div>
                {log.replied && (
                  <div className="text-blue-600">Replied: {formatDate(log.repliedAt)}</div>
                )}
              </div>
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span>Opens: {log.openCount}</span>
              <span>Clicks: {log.clickCount}</span>
              {log.replied && <span className="text-blue-600 font-medium">Replied ✓</span>}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

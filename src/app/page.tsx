"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

// ---- Types ----

interface Campaign {
  _id: string;
  name: string;
}

interface ContactRow {
  _id: string;
  businessName: string;
  contactEmail: string;
  contactName?: string;
  leadSource: string;
  pipelineStage: string;
  status: string;
  currentStage: number;
  engagementScore: number;
  lastSentAt?: string | null;
  opened?: boolean;
  clicked?: boolean;
  replied?: boolean;
}

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
  event_connection: "Event",
  other: "Other",
};

const STATUS_OPTIONS = ["", "active", "paused", "replied", "bounced", "unsubscribed"];
const PIPELINE_OPTIONS = ["", "not_started", "contacted", "replied", "call_booked", "proposal_sent", "won", "lost"];
const LEAD_SOURCE_OPTIONS = ["", "cold_email", "referral", "event_connection", "other"];

const HOT_THRESHOLD = 5;

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Check({ val }: { val?: boolean }) {
  return <span className={val ? "text-green-600 font-bold" : "text-gray-300"}>{val ? "✓" : "—"}</span>;
}

// ---- Page ----

export default function ContactsDashboard() {
  const router = useRouter();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [campaignId, setCampaignId] = useState("");
  const [pipelineStage, setPipelineStage] = useState("");
  const [leadSource, setLeadSource] = useState("");
  const [status, setStatus] = useState("");
  const [hotOnly, setHotOnly] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);

  // Load campaigns once
  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: Campaign[]) => setCampaigns(data))
      .catch(() => {/* non-fatal */});
  }, []);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ stats: "true" });
    if (campaignId) params.set("campaignId", campaignId);
    if (pipelineStage) params.set("pipelineStage", pipelineStage);
    if (leadSource) params.set("leadSource", leadSource);
    if (status) params.set("status", status);
    if (hotOnly) params.set("hot", "true");
    if (sortByScore) params.set("sort", "score");

    try {
      const res = await fetch(`/api/contacts?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ContactRow[];
      setContacts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [campaignId, pipelineStage, leadSource, status, hotOnly, sortByScore]);

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  return (
    <main className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Contacts</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-center bg-white border border-gray-200 rounded-lg p-4">
        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>

        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={pipelineStage}
          onChange={(e) => setPipelineStage(e.target.value)}
        >
          <option value="">All pipeline stages</option>
          {PIPELINE_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{PIPELINE_LABELS[s] ?? s}</option>
          ))}
        </select>

        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={leadSource}
          onChange={(e) => setLeadSource(e.target.value)}
        >
          <option value="">All lead sources</option>
          {LEAD_SOURCE_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{LEAD_SOURCE_LABELS[s] ?? s}</option>
          ))}
        </select>

        <select
          className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hotOnly}
            onChange={(e) => setHotOnly(e.target.checked)}
            className="rounded"
          />
          Hot leads only
        </label>

        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sortByScore}
            onChange={(e) => setSortByScore(e.target.checked)}
            className="rounded"
          />
          Sort by score
        </label>
      </div>

      {/* Error / loading */}
      {error && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">{error}</p>
      )}
      {loading && <p className="text-gray-500 text-sm mb-4">Loading&hellip;</p>}

      {/* Table */}
      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Business</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Lead source</th>
                <th className="px-4 py-3 text-left">Pipeline stage</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-center">Seq</th>
                <th className="px-4 py-3 text-left">Last sent</th>
                <th className="px-4 py-3 text-center">Opened</th>
                <th className="px-4 py-3 text-center">Clicked</th>
                <th className="px-4 py-3 text-center">Replied</th>
                <th className="px-4 py-3 text-center">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-6 text-center text-gray-400">
                    No contacts found.
                  </td>
                </tr>
              )}
              {contacts.map((c) => (
                <tr
                  key={c._id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => router.push(`/contacts/${c._id}`)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">{c.businessName}</td>
                  <td className="px-4 py-3 text-gray-600">{c.contactEmail}</td>
                  <td className="px-4 py-3 text-gray-600">{LEAD_SOURCE_LABELS[c.leadSource] ?? c.leadSource}</td>
                  <td className="px-4 py-3 text-gray-600">{PIPELINE_LABELS[c.pipelineStage] ?? c.pipelineStage}</td>
                  <td className="px-4 py-3"><StatusBadge value={c.status} /></td>
                  <td className="px-4 py-3 text-center text-gray-600">{c.currentStage}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(c.lastSentAt)}</td>
                  <td className="px-4 py-3 text-center"><Check val={c.opened} /></td>
                  <td className="px-4 py-3 text-center"><Check val={c.clicked} /></td>
                  <td className="px-4 py-3 text-center"><Check val={c.replied} /></td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={
                        (c.engagementScore ?? 0) >= HOT_THRESHOLD
                          ? "font-bold text-orange-600"
                          : "text-gray-700"
                      }
                    >
                      {c.engagementScore ?? 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

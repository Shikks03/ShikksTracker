"use client";

import { useCallback, useEffect, useState } from "react";

// ---- Types ----

interface Campaign {
  _id: string;
  name: string;
  offerSummary: string;
  toneNotes: string;
  sequenceSpacingDays: number[];
  createdAt: string;
}

interface CampaignStats {
  funnel: { sent: number; opened: number; clicked: number; replied: number };
  pipeline: Record<string, number>;
}

interface LeadSourceRow {
  leadSource: string;
  total: number;
  contacted: number;
  replied: number;
  won: number;
  replyRate: number;
  winRate: number;
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

// ---- Sub-components ----

function FunnelBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-20 text-gray-500 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
        <div
          className="bg-blue-500 h-2 rounded transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-gray-700 font-medium shrink-0">{value}</span>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CampaignStats>(`/api/campaigns/${campaign._id}/stats`).then(({ data, error }) => {
      if (error) setStatsError(error);
      else setStats(data);
    });
  }, [campaign._id]);

  const maxFunnel = stats?.funnel.sent ?? 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
        <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{campaign.offerSummary}</p>
        {campaign.toneNotes && (
          <p className="text-xs text-gray-400 mt-1">Tone: {campaign.toneNotes}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Spacing: {campaign.sequenceSpacingDays.join(" / ")} days
        </p>
      </div>

      {statsError && (
        <p className="text-xs text-red-500">Stats error: {statsError}</p>
      )}

      {stats && (
        <>
          {/* Funnel */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">Funnel</p>
            <div className="space-y-1.5">
              <FunnelBar label="Sent" value={stats.funnel.sent} max={maxFunnel} />
              <FunnelBar label="Opened" value={stats.funnel.opened} max={maxFunnel} />
              <FunnelBar label="Clicked" value={stats.funnel.clicked} max={maxFunnel} />
              <FunnelBar label="Replied" value={stats.funnel.replied} max={maxFunnel} />
            </div>
          </div>

          {/* Pipeline breakdown */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">Pipeline</p>
            <div className="flex flex-wrap gap-2">
              {PIPELINE_STAGES.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-xs text-gray-700"
                >
                  <span className="text-gray-400">{PIPELINE_LABELS[s]}</span>
                  <span className="font-medium">{stats.pipeline[s] ?? 0}</span>
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Create form ----

function CreateCampaignForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [offerSummary, setOfferSummary] = useState("");
  const [toneNotes, setToneNotes] = useState("");
  const [day0, setDay0] = useState("0");
  const [day1, setDay1] = useState("5");
  const [day2, setDay2] = useState("9");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await apiFetch("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name,
        offerSummary,
        toneNotes,
        sequenceSpacingDays: [
          parseInt(day0, 10) || 0,
          parseInt(day1, 10) || 5,
          parseInt(day2, 10) || 9,
        ],
      }),
    });
    setLoading(false);
    if (err) { setError(err); return; }
    setName(""); setOfferSummary(""); setToneNotes("");
    setDay0("0"); setDay1("5"); setDay2("9");
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <h2 className="font-semibold text-gray-800">New campaign</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Name *</label>
        <input
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Offer summary *</label>
        <textarea
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-y"
          rows={3}
          value={offerSummary}
          onChange={(e) => setOfferSummary(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600">Tone notes</label>
        <input
          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          value={toneNotes}
          onChange={(e) => setToneNotes(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Sequence spacing (days from first send)
        </label>
        <div className="flex gap-2 items-center">
          {[
            { label: "Stage 1", val: day0, set: setDay0 },
            { label: "Stage 2", val: day1, set: setDay1 },
            { label: "Stage 3", val: day2, set: setDay2 },
          ].map(({ label, val, set }) => (
            <div key={label} className="space-y-0.5">
              <label className="block text-xs text-gray-400">{label}</label>
              <input
                type="number"
                className="w-16 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={val}
                onChange={(e) => set(e.target.value)}
                min="0"
              />
            </div>
          ))}
        </div>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 transition-colors"
      >
        {loading ? "Creating…" : "Create campaign"}
      </button>
    </form>
  );
}

// ---- Page ----

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leadSources, setLeadSources] = useState<LeadSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [campaignsRes, lsRes] = await Promise.all([
      apiFetch<Campaign[]>("/api/campaigns"),
      apiFetch<LeadSourceRow[]>("/api/stats/lead-sources"),
    ]);
    if (campaignsRes.error) setError(campaignsRes.error);
    else setCampaigns(campaignsRes.data ?? []);
    setLeadSources(lsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>

      {/* Lead-source breakdown */}
      {leadSources.length > 0 && (
        <section>
          <h2 className="font-semibold text-gray-800 mb-3">Lead source breakdown</h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Contacted</th>
                  <th className="px-4 py-3 text-right">Replied</th>
                  <th className="px-4 py-3 text-right">Won</th>
                  <th className="px-4 py-3 text-right">Reply rate</th>
                  <th className="px-4 py-3 text-right">Win rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leadSources.map((row) => (
                  <tr key={row.leadSource}>
                    <td className="px-4 py-3 font-medium text-gray-800">
                      {LEAD_SOURCE_LABELS[row.leadSource] ?? row.leadSource}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{row.total}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{row.contacted}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{row.replied}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{row.won}</td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {(row.replyRate * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {(row.winRate * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Campaign list */}
      {loading && <p className="text-gray-500 text-sm">Loading&hellip;</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && campaigns.length === 0 && (
        <p className="text-gray-400">No campaigns yet.</p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {campaigns.map((c) => <CampaignCard key={c._id} campaign={c} />)}
      </div>

      {/* Create form */}
      <CreateCampaignForm onCreated={loadAll} />
    </main>
  );
}

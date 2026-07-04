"use client";

import { useCallback, useEffect, useState } from "react";

// ---- Types ----

interface Suppression {
  _id: string;
  email: string;
  reason: "unsubscribed" | "bounced" | "manual";
  addedAt: string;
}

const REASON_OPTIONS = ["unsubscribed", "bounced", "manual"] as const;

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

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---- Page ----

export default function SuppressionsPage() {
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  // Add form
  const [addEmail, setAddEmail] = useState("");
  const [addReason, setAddReason] = useState<typeof REASON_OPTIONS[number]>("manual");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { load(q); }, 300);
    return () => clearTimeout(t);
  }, [q, load]);

  async function handleDelete(id: string) {
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
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Suppressions</h1>

      {/* Search */}
      <div>
        <input
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="Search by email&hellip;"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* Error / loading */}
      {error && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded p-3">{error}</p>
      )}
      {loading && <p className="text-gray-500 text-sm">Loading&hellip;</p>}

      {/* Table */}
      {!loading && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Reason</th>
                <th className="px-4 py-3 text-left">Added</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppressions.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                    No suppressions found.
                  </td>
                </tr>
              )}
              {suppressions.map((s) => (
                <tr key={s._id}>
                  <td className="px-4 py-3 text-gray-800">{s.email}</td>
                  <td className="px-4 py-3 text-gray-600">{s.reason}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(s.addedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(s._id)}
                      className="text-xs text-red-600 hover:text-red-800 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">Add suppression</h2>
        {addError && <p className="text-sm text-red-600">{addError}</p>}
        <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1 flex-1 min-w-48">
            <label className="block text-xs font-medium text-gray-600">Email *</label>
            <input
              type="email"
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-600">Reason</label>
            <select
              className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value as typeof REASON_OPTIONS[number])}
            >
              {REASON_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addLoading}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 transition-colors"
          >
            {addLoading ? "Adding…" : "Add"}
          </button>
        </form>
      </section>
    </main>
  );
}

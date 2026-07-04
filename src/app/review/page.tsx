"use client";

/**
 * Review queue — Phase 6
 *
 * Minimal Tailwind UI for the email review gate.
 * Real dashboard styling is Phase 13.
 */

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmailLogItem {
  _id: string;
  contactId: string;
  stage: 1 | 2 | 3;
  status: "draft" | "approved" | "sent";
  subject: string;
  body: string;
}

interface ContactMap {
  [id: string]: string; // id → businessName
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { data: null, error: (body as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewPage() {
  const [drafts, setDrafts] = useState<EmailLogItem[]>([]);
  const [approved, setApproved] = useState<EmailLogItem[]>([]);
  const [contacts, setContacts] = useState<ContactMap>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Per-draft editing state
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadContacts = useCallback(async () => {
    const { data, error } = await apiFetch<{ _id: string; businessName: string }[]>(
      "/api/contacts"
    );
    if (error) {
      setGlobalError(`Failed to load contacts: ${error}`);
      return;
    }
    const map: ContactMap = {};
    for (const c of data ?? []) {
      map[c._id] = c.businessName;
    }
    setContacts(map);
  }, []);

  const loadLogs = useCallback(async () => {
    const [draftRes, approvedRes] = await Promise.all([
      apiFetch<EmailLogItem[]>("/api/email-logs?status=draft"),
      apiFetch<EmailLogItem[]>("/api/email-logs?status=approved"),
    ]);

    if (draftRes.error) {
      setGlobalError(`Failed to load drafts: ${draftRes.error}`);
    } else {
      const newDrafts = draftRes.data ?? [];
      setDrafts(newDrafts);
      // Seed edit state for new drafts
      setEdits((prev) => {
        const next = { ...prev };
        for (const d of newDrafts) {
          if (!next[d._id]) {
            next[d._id] = { subject: d.subject, body: d.body };
          }
        }
        return next;
      });
    }

    if (approvedRes.error) {
      setGlobalError(`Failed to load approved: ${approvedRes.error}`);
    } else {
      setApproved(approvedRes.data ?? []);
    }
  }, []);

  const refresh = useCallback(async () => {
    setGlobalError(null);
    await loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadContacts();
    loadLogs();
  }, [loadContacts, loadLogs]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleSave(id: string) {
    const edit = edits[id];
    if (!edit) return;
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ subject: edit.subject, body: edit.body }),
    });
    if (error) {
      setGlobalError(`Save failed: ${error}`);
    } else {
      await refresh();
    }
  }

  async function handleApprove(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    if (error) {
      setGlobalError(`Approve failed: ${error}`);
    } else {
      await refresh();
    }
  }

  async function handleDiscard(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "DELETE",
    });
    if (error) {
      setGlobalError(`Discard failed: ${error}`);
    } else {
      await refresh();
    }
  }

  async function handleUnapprove(id: string) {
    const { error } = await apiFetch(`/api/email-logs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "draft" }),
    });
    if (error) {
      setGlobalError(`Unapprove failed: ${error}`);
    } else {
      await refresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="max-w-4xl mx-auto p-6 font-sans">
      <h1 className="text-2xl font-bold mb-6">Email Review Queue</h1>

      {globalError && (
        <p className="text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-6">
          {globalError}
        </p>
      )}

      {/* ---- Drafts ---- */}
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">
          Drafts ({drafts.length})
        </h2>

        {drafts.length === 0 && (
          <p className="text-gray-500">No drafts pending review.</p>
        )}

        <div className="space-y-6">
          {drafts.map((log) => {
            const edit = edits[log._id] ?? { subject: log.subject, body: log.body };
            const businessName = contacts[log.contactId] ?? log.contactId;

            return (
              <div
                key={log._id}
                className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm"
              >
                <div className="mb-2 text-sm text-gray-500">
                  <span className="font-medium text-gray-800">{businessName}</span>
                  {" — "}Stage {log.stage}
                </div>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={edit.subject}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [log._id]: { ...prev[log._id], subject: e.target.value },
                      }))
                    }
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Body
                  </label>
                  <textarea
                    value={edit.body}
                    onChange={(e) =>
                      setEdits((prev) => ({
                        ...prev,
                        [log._id]: { ...prev[log._id], body: e.target.value },
                      }))
                    }
                    rows={8}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => handleSave(log._id)}
                    className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-800 rounded border border-gray-300 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => handleApprove(log._id)}
                    className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDiscard(log._id)}
                    className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                  >
                    Discard
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Approved (queued for send) ---- */}
      <section>
        <h2 className="text-xl font-semibold mb-4">
          Approved — queued for send ({approved.length})
        </h2>

        {approved.length === 0 && (
          <p className="text-gray-500">No emails queued for sending.</p>
        )}

        <div className="space-y-4">
          {approved.map((log) => {
            const businessName = contacts[log.contactId] ?? log.contactId;
            return (
              <div
                key={log._id}
                className="border border-green-200 rounded-lg p-4 bg-green-50 flex items-start justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-medium text-gray-800">
                    {businessName} — Stage {log.stage}
                  </div>
                  <div className="text-sm text-gray-600 mt-0.5">{log.subject}</div>
                </div>
                <button
                  onClick={() => handleUnapprove(log._id)}
                  className="shrink-0 px-3 py-1.5 text-sm bg-white hover:bg-gray-100 text-gray-700 rounded border border-gray-300 transition-colors"
                >
                  Unapprove
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

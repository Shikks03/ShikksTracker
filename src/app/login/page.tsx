"use client";

import { useEffect, useState } from "react";
import { Panel, Button, inputClass } from "@/components/ui";
import { serif, grotesk, mono, INK, FAINT, CLAY, PAPER } from "@/components/tokens";

// ── Login page ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [from, setFrom]         = useState("/");

  // Read ?from= redirect param once on mount.
  // Resolve against our own origin and re-check it — string checks alone are not
  // enough (browsers normalize "/\evil.com" and "//evil.com" to external URLs).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const f = params.get("from");
    if (!f || !f.startsWith("/")) return;
    try {
      const resolved = new URL(f, window.location.origin);
      if (resolved.origin === window.location.origin) {
        setFrom(resolved.pathname + resolved.search);
      }
    } catch {
      // malformed value — keep the "/" default
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = from;
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Login failed");
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    /*
     * Full-screen overlay covering the sidebar that the root layout renders.
     * z-index 9999 ensures it sits above all other content.
     */
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: PAPER,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400, padding: "0 24px" }}>

        {/* Wordmark / title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <span
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: FAINT,
              display: "block",
              marginBottom: 12,
            }}
          >
            SHIKKS TRACKER
          </span>
          <h1
            style={{
              fontFamily: serif,
              fontSize: 34,
              fontWeight: 400,
              color: INK,
              letterSpacing: "-0.01em",
              margin: 0,
              lineHeight: 1.1,
            }}
          >
            Sign in
          </h1>
        </div>

        {/* Login panel */}
        <Panel style={{ padding: "28px 28px 24px" }}>
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="login-password"
              style={{
                display: "block",
                fontFamily: mono,
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: FAINT,
                marginBottom: 8,
              }}
            >
              Password
            </label>

            <input
              id="login-password"
              type="password"
              className={inputClass}
              placeholder="Enter your dashboard password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              required
            />

            {error && (
              <div style={{ marginTop: 12 }}>
                <span
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: CLAY,
                  }}
                >
                  {error}
                </span>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <Button
                type="submit"
                variant="dark"
                disabled={loading || !password}
                className="w-full"
              >
                {loading ? "Signing in…" : "Sign in"}
              </Button>
            </div>
          </form>
        </Panel>

        {/* Footer note */}
        <p
          style={{
            marginTop: 20,
            textAlign: "center",
            fontFamily: grotesk,
            fontSize: 13,
            color: FAINT,
            lineHeight: 1.5,
          }}
        >
          Set <code style={{ fontFamily: mono, fontSize: 12 }}>DASHBOARD_PASSWORD</code>{" "}
          in your environment to configure access.
        </p>

      </div>
    </div>
  );
}

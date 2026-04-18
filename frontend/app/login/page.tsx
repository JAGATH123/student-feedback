"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAuth } from "../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) { setError("Invalid username or password."); setLoading(false); return; }
      const data = await res.json();
      setAuth({ token: data.access_token, role: data.role, username: data.username, full_name: data.full_name });
      router.push("/admin");
    } catch {
      setError("Could not connect to server."); setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 24px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--brand)", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--brand-glow)" }}>
            <span style={{ fontSize: 24 }}>👁️</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 900, color: "var(--text-heading)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>
            EMOTION KIOSK
          </h1>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.3em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            PORTAL LOGIN
          </p>
        </div>

        {/* Card */}
        <div className="card">
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                USERNAME
              </label>
              <input
                required autoFocus
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                className="input"
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                PASSWORD
              </label>
              <input
                required type="password"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                className="input"
              />
            </div>

            {error && (
              <div style={{ background: "var(--red-bg)", border: "1px solid var(--red-border)", borderRadius: "var(--radius-md)", padding: "10px 14px", marginBottom: 16, fontFamily: "var(--font-body)", fontSize: 14, color: "var(--red)" }}>
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "13px", fontSize: 13 }} disabled={loading}>
              {loading ? "SIGNING IN…" : "SIGN IN →"}
            </button>
          </form>
        </div>

        {/* Role hint */}
        <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
          {[
            { role: "ADMIN", desc: "Full access · delete workshops" },
            { role: "TRAINER", desc: "Own workshops · no delete" },
          ].map(({ role, desc }) => (
            <div key={role} style={{ flex: 1, background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 14px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 4 }}>{role}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--text-muted)" }}>{desc}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

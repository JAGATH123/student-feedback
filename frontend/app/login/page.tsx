"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(16px, 5vw, 40px) 0" }}>
      <div style={{ width: "100%", maxWidth: 420, padding: "0 clamp(16px, 5vw, 24px)" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "clamp(24px, 6vw, 40px)" }}>
          {/* Company logo */}
          <div style={{
            margin: "0 auto clamp(16px, 4vw, 24px)",
            width: "clamp(100px, 30vw, 160px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Image
              src="/lof_logo.png"
              alt="LOF Logo"
              width={160}
              height={80}
              priority
              style={{
                width: "100%",
                height: "auto",
                objectFit: "contain",
              }}
            />
          </div>

          {/* Divider */}
          <div style={{ width: 40, height: 2, background: "var(--brand)", margin: "0 auto clamp(12px, 3vw, 18px)", borderRadius: 2 }} />

          <h1 style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(16px, 4.5vw, 22px)",
            fontWeight: 900,
            color: "var(--text-heading)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}>
            EMOTION KIOSK
          </h1>
          <p style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(8px, 2vw, 10px)",
            letterSpacing: "0.3em",
            color: "var(--text-muted)",
            textTransform: "uppercase",
          }}>
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


      </div>
    </div>
  );
}

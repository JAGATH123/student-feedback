"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAuth, clearAuth, apiFetch } from "../lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Workshop { id: string; title: string; trainer: string; conducted_on: string; }
interface Session  { id: string; batch_name: string; workshop_id: string; started_at: string; }
interface FeedEntry {
  capture_id: string; session_id: string; batch_name: string; workshop_title: string;
  started_at: string; captured_at: string | null;
  dominant_emotion: string | null; rating_bucket: string | null;
  duration_seconds: number | null; status: "IN_PROGRESS" | "COMPLETE";
}

const EMOTION_EMOJI: Record<string, string> = {
  happy: "😊", neutral: "😐", sad: "😢",
  surprise: "😊", fear: "😢", angry: "😢", disgust: "😢", contempt: "😢",
};

function toDisplayEmotion(raw: string | null, bucket: string | null = null): { label: string; emoji: string } {
  if (!raw || raw === "face_not_detected") return { label: "—", emoji: "😶" };
  if (raw === "gesture_rating") {
    if (bucket === "POSITIVE") return { label: "HAPPY",   emoji: "😊" };
    if (bucket === "NEGATIVE") return { label: "SAD",     emoji: "😢" };
    return                            { label: "NEUTRAL", emoji: "😐" };
  }
  if (["happy", "surprise"].includes(raw)) return { label: "HAPPY",   emoji: "😊" };
  if (raw === "neutral")                   return { label: "NEUTRAL", emoji: "😐" };
  return                                          { label: "SAD",     emoji: "😢" };
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700,
      letterSpacing: "0.3em", textTransform: "uppercase",
      color: "var(--text-muted)", marginBottom: 16,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
      {children}
    </div>
  );
}

const IST = { timeZone: "Asia/Kolkata" };

function timeOfDay(iso: string) {
  const h = parseInt(new Date(iso + "Z").toLocaleString("en-IN", { ...IST, hour: "numeric", hour12: false }));
  if (h >= 6  && h < 12) return "Morning";
  if (h >= 12 && h < 16) return "Afternoon";
  if (h >= 16 && h < 20) return "Evening";
  return "Night";
}

function formatTime(iso: string) {
  return new Date(iso + "Z").toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function AdminPage() {
  const router = useRouter();
  const [auth, setAuthState] = useState<ReturnType<typeof getAuth>>(null);

  const [workshops,       setWorkshops]       = useState<Workshop[]>([]);
  const [title,           setTitle]           = useState("");
  const [trainer,         setTrainer]         = useState("");
  const [date,            setDate]            = useState(new Date().toISOString().split("T")[0]);
  const [creating,        setCreating]        = useState(false);
  const [step,            setStep]            = useState<1 | 2>(1);
  const [batchWorkshopId, setBatchWorkshopId] = useState("");
  const [batchName,       setBatchName]       = useState("");
  const [session,         setSession]         = useState<Session | null>(null);
  const [feed,            setFeed]            = useState<FeedEntry[]>([]);
  const [lastPoll,        setLastPoll]        = useState<Date | null>(null);
  const [expandedWs,      setExpandedWs]      = useState<string | null>(null);
  const [wsSessions,      setWsSessions]      = useState<Record<string, Session[]>>({});
  const [copied,          setCopied]          = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const a = getAuth();
    if (!a) { router.push("/login"); return; }
    setAuthState(a);
  }, [router]);

  const loadWorkshops = useCallback(async () => {
    const res = await apiFetch(`${API}/workshops`);
    if (res.ok) setWorkshops(await res.json());
  }, []);

  const loadFeed = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/feed/recent?limit=100`);
      if (res.ok) {
        const all: FeedEntry[] = await res.json();
        const today = new Date().toDateString();
        setFeed(all.filter(f => new Date(f.started_at).toDateString() === today));
        setLastPoll(new Date());
      }
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => {
    loadWorkshops();
    loadFeed();
    // Clear any existing interval before creating a new one (prevents HMR stacking)
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(loadFeed, 5000);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [loadWorkshops, loadFeed]);

  async function createWorkshop(e: React.FormEvent) {
    e.preventDefault(); setCreating(true);
    const res = await apiFetch(`${API}/workshops`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, trainer, conducted_on: date }),
    });
    const newWs = await res.json();
    setWorkshops(prev => [newWs, ...prev]);
    setBatchWorkshopId(newWs.id);
    setTitle(""); setTrainer(""); setCreating(false); setStep(2);
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch(`${API}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workshop_id: batchWorkshopId, batch_name: batchName }),
    });
    setSession(await res.json()); setBatchName("");
  }

  const kioskUrl = (sid: string) =>
    typeof window !== "undefined" ? `${window.location.origin}/kiosk/${sid}` : `/kiosk/${sid}`;

  async function toggleWorkshop(wsId: string) {
    if (expandedWs === wsId) { setExpandedWs(null); return; }
    setExpandedWs(wsId);
    if (!wsSessions[wsId]) {
      const res = await apiFetch(`${API}/workshops/${wsId}/sessions`);
      if (res.ok) {
        const sessions = await res.json();
        setWsSessions(prev => ({ ...prev, [wsId]: sessions }));
      }
    }
  }

  function copyUrl(sid: string) {
    navigator.clipboard.writeText(kioskUrl(sid));
    setCopied(sid);
    setTimeout(() => setCopied(null), 2000);
  }

  async function deleteSession(wsId: string, sid: string) {
    if (!confirm("Delete this session and all its captures?")) return;
    await apiFetch(`${API}/sessions/${sid}`, { method: "DELETE" });
    setWsSessions(prev => ({ ...prev, [wsId]: prev[wsId].filter(s => s.id !== sid) }));
  }

  async function deleteWorkshop(wsId: string) {
    if (!confirm("Delete this workshop and ALL its sessions and captures?")) return;
    await apiFetch(`${API}/workshops/${wsId}`, { method: "DELETE" });
    setWorkshops(prev => prev.filter(w => w.id !== wsId));
    if (expandedWs === wsId) setExpandedWs(null);
  }

  function handleLogout() { clearAuth(); router.push("/login"); }

  const inProgress = feed.filter(f => f.status === "IN_PROGRESS").length;
  const completed  = feed.filter(f => f.status === "COMPLETE").length;

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>

      {/* ── TOP BAR ──────────────────────────────────────────────────────────── */}
      <header className="top-header-new" style={{
        background: "var(--bg-white)", borderBottom: "2px solid var(--border)",
        padding: "0 40px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "var(--shadow-sm)",
      }}>
        <div className="header-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="dot" style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 8px var(--brand)" }} className="animate-pulse-dot" />
          <span className="header-title-content" style={{ fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-heading)" }}>EMOTION FEEDBACK PORTAL</span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 500, letterSpacing: "0.3em", color: "var(--text-muted)" }}>
            {auth?.role === "admin" ? "ADMIN CONSOLE" : "TRAINER PORTAL"}
          </span>
        </div>
        <div className="admin-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* {lastPoll && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
              UPDATED {formatTime(lastPoll.toISOString())}
            </span>
          )} */}
          {/* <span className="badge badge-brand">LIVE</span> */}
          {/* {auth && (
            <span className={`badge ${auth.role === "admin" ? "badge-negative" : "badge-positive"}`}>
              {auth.role.toUpperCase()}
            </span>
          )} */}
          {auth && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{auth.username}</span>
          )}
          <button onClick={handleLogout} className="btn btn-secondary" style={{ fontSize: 10, padding: "5px 12px" }}>LOGOUT</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── STAT ROW ────────────────────────────────────────────────────────── */}
        <div className="countdown-sec" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 28 }}>
          {[
            { label: "Workshops",       value: workshops.length, color: "var(--brand)" },
            { label: "Total Responses", value: completed,        color: "#059669"      },
            { label: "In Progress",     value: inProgress,       color: "#d97706"      },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ textAlign: "center", padding: "18px 12px" }}>
              <div className="text" style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
              <div className="number" style={{ fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: auth?.role === "admin" ? "1fr" : "1fr 1.1fr", gap: 20, marginBottom: 28 }}>

          {/* ── TRAINER ONLY: SETUP WIZARD ────────────────────────────────────── */}
          {auth?.role === "trainer" && (
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 24 }}>
              {(["CREATE WORKSHOP", "KIOSK URL"] as const).map((label, i) => {
                const n = i + 1; const active = step === n; const done = step > n;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: done ? "var(--emerald)" : active ? "var(--brand)" : "#e5e7eb",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700,
                        color: (active || done) ? "#fff" : "var(--text-muted)",
                        boxShadow: active ? "var(--brand-glow)" : done ? "0 0 10px rgba(5,150,105,0.4)" : "none",
                        transition: "all 0.3s",
                      }}>{done ? "✓" : n}</div>
                      <span style={{ fontFamily: "var(--font-heading)", fontSize: 8, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: active ? "var(--brand)" : done ? "var(--emerald)" : "var(--text-muted)" }}>{label}</span>
                    </div>
                    {i < 1 && <div style={{ flex: 1, height: 2, margin: "0 6px", background: done ? "var(--brand)" : "var(--border)", transition: "background 0.3s", marginTop: -18 }} />}
                  </div>
                );
              })}
            </div>

            {step === 1 && (
              <>
                <SectionHeader>New Workshop</SectionHeader>
                <form onSubmit={createWorkshop}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
                    <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Workshop title" className="input" />
                    <input required value={trainer} onChange={e => setTrainer(e.target.value)} placeholder="Trainer name" className="input" />
                    <input required type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "11px", fontSize: 12 }} disabled={creating}>
                    {creating ? "CREATING…" : "CREATE WORKSHOP →"}
                  </button>
                </form>
              </>
            )}

            {step === 2 && (
              <>
                <SectionHeader>Generate Kiosk Session URL</SectionHeader>
                <form onSubmit={createSession} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 10 }}>
                    <select required value={batchWorkshopId} onChange={e => setBatchWorkshopId(e.target.value)} className="input" style={{ appearance: "auto" }}>
                      <option value="">— Select workshop —</option>
                      {workshops.map(w => <option key={w.id} value={w.id}>{w.title} ({w.conducted_on})</option>)}
                    </select>
                    <input required value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. Batch 1 — Morning" className="input" />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "11px", fontSize: 12 }}>GENERATE URL</button>
                </form>

                {session && (
                  <div style={{ background: "var(--brand-bg)", border: "2px solid var(--brand-border)", borderRadius: "var(--radius-md)", padding: "12px 16px" }}>
                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--brand)", textTransform: "uppercase", marginBottom: 4 }}>
                      ✓ URL READY — {session.batch_name}
                    </div>
                    <a href={kioskUrl(session.id)} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--brand)", wordBreak: "break-all", textDecoration: "underline" }}>
                      {kioskUrl(session.id)}
                    </a>
                  </div>
                )}

                <button onClick={() => setStep(1)} className="btn btn-secondary" style={{ marginTop: 10, fontSize: 10 }}>← Add another workshop</button>
              </>
            )}
          </div>
          )}

          {/* ── LIVE ACTIVITY FEED ────────────────────────────────────────────── */}
          <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "20px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div className="live-student-text" style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 10 }}>
                  <span  style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
                  LIVE STUDENT FEED
                </div>
                {inProgress > 0 && (
                  <span className="badge badge-average" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#294973", display: "inline-block" }} />
                    {inProgress} IN PROGRESS
                  </span>
                )}
              </div>
            </div>

            {feed.length === 0 ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>👁️</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Waiting for students…
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>
                  Activity appears here the moment a student taps Begin
                </div>
              </div>
            ) : (
              <div style={{ overflowY: "auto", maxHeight: 420 }}>
                {feed.slice(0, 25).map((entry, idx) => (
                  <div key={entry.capture_id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 20px",
                    borderBottom: "1px solid var(--border)",
                    background: entry.status === "IN_PROGRESS" ? "rgba(28,77,140,0.04)" : "transparent",
                    transition: "background 0.3s",
                  }}>
                    {/* student number */}
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", minWidth: 28, textAlign: "right" }}>
                      #{feed.length - idx}
                    </div>

                    {/* status dot */}
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: entry.status === "IN_PROGRESS" ? "#294973" : "var(--brand)",
                      boxShadow: entry.status === "IN_PROGRESS" ? "0 0 6px #294973" : "0 0 6px var(--brand)",
                    }} className={entry.status === "IN_PROGRESS" ? "animate-pulse-dot" : ""} />

                    {/* main info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, color: "var(--text-heading)" }}>
                          {entry.batch_name}
                        </span>
                        <span style={{ fontFamily: "var(--font-heading)", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.1em" }}>
                          {entry.workshop_title}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                        {formatTime(entry.started_at)} · {timeOfDay(entry.started_at)}
                      </div>
                    </div>

                    {/* result */}
                    {entry.status === "COMPLETE" && entry.dominant_emotion ? (
                      (() => {
                        const d = toDisplayEmotion(entry.dominant_emotion, entry.rating_bucket);
                        const badgeCls = d.label === "HAPPY" ? "badge-positive" : d.label === "SAD" ? "badge-negative" : "badge-average";
                        return (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span style={{ fontSize: 16 }}>{d.emoji}</span>
                            <span className={`badge ${badgeCls}`}>{d.label}</span>
                          </div>
                        );
                      })()
                    ) : (
                      <span className="badge badge-average">IN PROGRESS…</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── WORKSHOP TABLE ────────────────────────────────────────────────── */}
        <div className="card workshop-table" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "20px 24px 0" }}>
            <SectionHeader>All Workshops</SectionHeader>
          </div>
          {workshops.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 15, color: "var(--text-muted)" }}>
              No workshops yet. Create one above.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>WORKSHOP</th><th>TRAINER</th><th>DATE</th><th>STATUS</th>
                  <th style={{ textAlign: "right" }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {workshops.map(w => (
                  <>
                    <tr key={w.id} style={{ cursor: "pointer" }} onClick={() => toggleWorkshop(w.id)}>
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ marginRight: 8, fontSize: 10, color: "var(--text-muted)" }}>
                          {expandedWs === w.id ? "▼" : "▶"}
                        </span>
                        {w.title}
                      </td>
                      <td>{w.trainer}</td>
                      <td><span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{w.conducted_on}</span></td>
                      <td><span className="badge badge-brand">ACTIVE</span></td>
                      <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            onClick={() => { setBatchWorkshopId(w.id); setStep(2); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                            className="btn btn-primary" style={{ fontSize: 10, padding: "6px 12px" }}
                          >
                            + NEW SESSION
                          </button>
                          <Link href={`/admin/workshop/${w.id}`} className="btn btn-secondary" style={{ fontSize: 10, padding: "6px 14px" }}>
                            ANALYTICS →
                          </Link>
                          {auth?.role === "admin" && (
                            <button
                              onClick={() => deleteWorkshop(w.id)}
                              className="btn" style={{ fontSize: 10, padding: "6px 12px", background: "var(--red-bg)", borderColor: "var(--red-border)", color: "var(--red)" }}
                            >
                              DELETE
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── EXPANDED SESSION ROWS ── */}
                    {expandedWs === w.id && (
                      <tr key={`${w.id}-sessions`}>
                        <td colSpan={5} style={{ padding: "0 0 0 40px", background: "var(--bg-primary)" }}>
                          {!wsSessions[w.id] ? (
                            <div style={{ padding: "12px 16px", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)" }}>Loading sessions…</div>
                          ) : wsSessions[w.id].length === 0 ? (
                            <div style={{ padding: "12px 16px", fontFamily: "var(--font-body)", fontSize: 13, color: "var(--text-muted)" }}>No sessions yet — click + NEW SESSION above.</div>
                          ) : (
                            <div style={{ padding: "8px 0 12px" }}>
                              {wsSessions[w.id].map(s => (
                                <div key={s.id} style={{
                                  display: "flex", alignItems: "center", gap: 10,
                                  padding: "10px 16px", marginRight: 16, marginBottom: 6,
                                  background: "var(--bg-white)", borderRadius: "var(--radius-md)",
                                  border: "1px solid var(--border)",
                                }}>
                                  {/* batch name */}
                                  <div style={{ minWidth: 140, flexShrink: 0 }}>
                                    <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, color: "var(--text-heading)", letterSpacing: "0.05em" }}>{s.batch_name}</div>
                                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                      {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {s.id.slice(0, 8).toUpperCase()}
                                    </div>
                                  </div>

                                  {/* kiosk URL */}
                                  <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--brand)", background: "var(--brand-bg)", borderRadius: "var(--radius-sm)", padding: "6px 10px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {kioskUrl(s.id)}
                                  </div>

                                  {/* actions */}
                                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                                    <button
                                      onClick={() => copyUrl(s.id)}
                                      className="btn btn-primary" style={{ fontSize: 10, padding: "6px 12px", background: copied === s.id ? "#059669" : "var(--brand)", borderColor: copied === s.id ? "#059669" : "var(--brand)" }}
                                    >
                                      {copied === s.id ? "✓ COPIED" : "COPY URL"}
                                    </button>
                                    <Link href={`/admin/session/${s.id}`} className="btn btn-secondary" style={{ fontSize: 10, padding: "6px 10px" }}>
                                      LIVE
                                    </Link>
                                    {auth?.role === "admin" && (
                                      <button
                                        onClick={() => deleteSession(w.id, s.id)}
                                        className="btn" style={{ fontSize: 10, padding: "6px 10px", background: "var(--red-bg)", borderColor: "var(--red-border)", color: "var(--red)" }}
                                      >
                                        DELETE
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </main>
    </div>
  );
}

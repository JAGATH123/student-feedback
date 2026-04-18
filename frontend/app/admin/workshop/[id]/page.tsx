"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getAuth, clearAuth, apiFetch } from "../../../lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

// Maps all 8 model labels → display {emoji, label}
const EMOTION_DISPLAY: Record<string, { emoji: string; label: string }> = {
  happy:             { emoji: "😄", label: "Happy"   },
  neutral:           { emoji: "😐", label: "Neutral" },
  angry:             { emoji: "😠", label: "Angry"   },
  sad:               { emoji: "😢", label: "Sad"     },
  surprise:          { emoji: "😄", label: "Happy"   },
  fear:              { emoji: "😢", label: "Sad"     },
  disgust:           { emoji: "😠", label: "Angry"   },
  contempt:          { emoji: "😠", label: "Angry"   },
  face_not_detected: { emoji: "😶", label: "No Face" },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}
function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

interface SessionStat {
  session_id: string; batch_name: string;
  total: number; positive: number; average: number; negative: number;
}
interface Analytics {
  workshop_id: string; title: string;
  total_captures: number; positive: number; average: number; negative: number;
  sessions: SessionStat[];
}
interface FeedEntry {
  capture_id: string; session_id: string; batch_name: string;
  started_at: string; captured_at: string | null;
  dominant_emotion: string | null; rating_bucket: string | null;
  duration_seconds: number | null; status: "IN_PROGRESS" | "COMPLETE";
}

const PIE_COLORS  = ["#1C4D8C", "#294973", "#D93A2B"];
const BUCKET_BADGE: Record<string, string> = {
  POSITIVE: "badge-positive", AVERAGE: "badge-average", NEGATIVE: "badge-negative",
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number }> }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "2px solid var(--border)", borderRadius: 8, padding: "8px 14px", fontFamily: "var(--font-heading)", fontSize: 11 }}>
      <span style={{ color: "var(--text-secondary)", letterSpacing: "0.1em" }}>{payload[0].name.toUpperCase()}: </span>
      <strong style={{ color: "var(--text-heading)" }}>{payload[0].value}</strong>
    </div>
  );
}

export default function WorkshopAnalytics() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const auth     = getAuth();

  const [data,    setData]    = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [feed,    setFeed]    = useState<FeedEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (!getAuth()) router.push("/login"); }, [router]);

  const loadFeed = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/workshops/${id}/feed?limit=50`);
      if (res.ok) setFeed(await res.json());
    } catch { /* offline */ }
  }, [id]);

  useEffect(() => {
    apiFetch(`${API}/workshops/${id}/analytics`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadFeed();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(loadFeed, 5000);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [loadFeed]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 48, height: 48, margin: "0 auto 16px", border: "3px solid var(--brand-bg)", borderTop: "3px solid var(--brand)", borderRadius: "50%" }} className="animate-spin-slow" />
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 11, letterSpacing: "0.3em", color: "var(--text-muted)" }}>LOADING…</div>
      </div>
    </div>
  );

  if (!data) return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "var(--font-heading)", color: "var(--red)" }}>Workshop not found.</div>
    </div>
  );

  const pieData = [
    { name: "Positive", value: data.positive },
    { name: "Neutral",  value: data.average  },
    { name: "Negative", value: data.negative },
  ];

  const inProgress = feed.filter(f => f.status === "IN_PROGRESS").length;

  if (!data) return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, letterSpacing: "0.2em", color: "var(--text-muted)" }}>LOADING…</div>
    </div>
  );

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>

      {/* ── HEADER ── */}
      <header style={{ background: "var(--bg-white)", borderBottom: "2px solid var(--border)", padding: "0 40px", height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/admin" className="btn btn-secondary" style={{ fontSize: 10, padding: "6px 12px" }}>← BACK</Link>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--text-heading)" }}>{data.title.toUpperCase()}</div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "var(--text-muted)" }}>ANALYTICS REPORT</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {inProgress > 0 && <span className="badge badge-average" style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706", display: "inline-block" }} />{inProgress} IN PROGRESS</span>}
          <span className="badge badge-brand">{data.total_captures} CAPTURES</span>
          {auth && <span className={`badge ${auth.role === "admin" ? "badge-negative" : "badge-positive"}`}>{auth.role.toUpperCase()}</span>}
          {auth && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{auth.username}</span>}
          <button onClick={() => { clearAuth(); router.push("/login"); }} className="btn btn-secondary" style={{ fontSize: 10, padding: "5px 12px" }}>LOGOUT</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "36px 24px" }}>

        {/* ── 3 KPI CARDS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
          {[
            { label: "Total Responses", value: data.total_captures, color: "var(--brand)" },
            { label: "Positive",  value: `${pct(data.positive, data.total_captures)}%`, color: "#059669" },
            { label: "Neutral",   value: `${pct(data.average,  data.total_captures)}%`, color: "#294973" },
            { label: "Negative",  value: `${pct(data.negative, data.total_captures)}%`, color: "#D93A2B" },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 900, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── PIE + RATING BARS ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 20, marginBottom: 28 }}>

          {/* Pie chart */}
          <div className="card">
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
              SENTIMENT SPLIT
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                  labelLine={false}>
                  {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 8 }}>
              {(["Positive","Neutral","Negative"] as const).map((l, i) => (
                <span key={l} className={`badge ${i === 0 ? "badge-positive" : i === 1 ? "badge-average" : "badge-negative"}`}>{l}</span>
              ))}
            </div>
          </div>

          {/* 3-bucket bars */}
          <div className="card">
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 24, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
              RESPONSE BREAKDOWN
            </div>
            {[
              { label: "POSITIVE",  count: data.positive, color: "#1C4D8C", bg: "rgba(28,77,140,0.08)"  },
              { label: "NEUTRAL",   count: data.average,  color: "#294973", bg: "rgba(41,73,115,0.08)"  },
              { label: "NEGATIVE",  count: data.negative, color: "#D93A2B", bg: "rgba(217,58,43,0.08)" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color }}>{label}</span>
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 900, color }}>{count}<span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)", marginLeft: 4 }}>({pct(count, data.total_captures)}%)</span></span>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: bg, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct(count, data.total_captures)}%`, background: color, borderRadius: 5, transition: "width 0.6s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── LIVE STUDENT FEED ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 28 }}>
          <div style={{ padding: "20px 24px 0" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
              LIVE STUDENT ACTIVITY
            </div>
          </div>
          {feed.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)" }}>No activity yet. Feed updates every 3 seconds.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>#</th><th>BATCH</th><th>STARTED</th><th>STATUS</th><th>EMOTION</th><th>RATING</th><th style={{ textAlign: "right" }}>DURATION</th></tr>
              </thead>
              <tbody>
                {feed.map((entry, idx) => (
                  <tr key={entry.capture_id} style={{ background: entry.status === "IN_PROGRESS" ? "rgba(28,77,140,0.03)" : "transparent" }}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>#{feed.length - idx}</td>
                    <td style={{ fontWeight: 600 }}>{entry.batch_name}</td>
                    <td>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{formatTime(entry.started_at)}</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{timeAgo(entry.started_at)}</div>
                    </td>
                    <td>
                      {entry.status === "IN_PROGRESS"
                        ? <span className="badge badge-average" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span className="animate-pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "#d97706", display: "inline-block" }} />IN PROGRESS</span>
                        : <span className="badge badge-positive">COMPLETE</span>}
                    </td>
                    <td>
                      {entry.dominant_emotion && entry.dominant_emotion !== "face_not_detected"
                        ? (() => { const d = EMOTION_DISPLAY[entry.dominant_emotion] ?? { emoji: "🙂", label: entry.dominant_emotion }; return (
                            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span>{d.emoji}</span>
                              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600 }}>{d.label}</span>
                            </span>); })()
                        : entry.dominant_emotion === "face_not_detected"
                          ? <span style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.1em", color: "var(--text-muted)" }}>😶 NO FACE</span>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td>
                      {entry.rating_bucket
                        ? <span className={`badge ${BUCKET_BADGE[entry.rating_bucket]}`}>{entry.rating_bucket}</span>
                        : entry.dominant_emotion === "face_not_detected"
                          ? <span className="badge" style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#9ca3af" }}>SKIPPED</span>
                          : <span style={{ color: "var(--text-muted)" }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                      {entry.duration_seconds !== null ? `${entry.duration_seconds}s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── BATCH BREAKDOWN ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "20px 24px 0" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
              BATCH BREAKDOWN
            </div>
          </div>
          {data.sessions.length === 0 ? (
            <div style={{ padding: "32px 24px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)" }}>No sessions recorded yet.</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>BATCH</th><th>SESSION ID</th><th style={{ textAlign: "center" }}>TOTAL</th><th style={{ textAlign: "center" }}>POSITIVE</th><th style={{ textAlign: "center" }}>NEUTRAL</th><th style={{ textAlign: "center" }}>NEGATIVE</th><th></th></tr>
              </thead>
              <tbody>
                {data.sessions.map(s => (
                  <tr key={s.session_id}>
                    <td style={{ fontWeight: 600 }}>{s.batch_name}</td>
                    <td><span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{s.session_id.slice(0, 8).toUpperCase()}</span></td>
                    <td style={{ textAlign: "center" }}><strong style={{ fontFamily: "var(--font-heading)", color: "var(--brand)" }}>{s.total}</strong></td>
                    <td style={{ textAlign: "center" }}><span className="badge badge-positive">{pct(s.positive, s.total)}%</span></td>
                    <td style={{ textAlign: "center" }}><span className="badge badge-average">{pct(s.average,  s.total)}%</span></td>
                    <td style={{ textAlign: "center" }}><span className="badge badge-negative">{pct(s.negative, s.total)}%</span></td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/admin/session/${s.session_id}`} className="btn btn-primary" style={{ fontSize: 10, padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }} />
                        LIVE VIEW
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAuth, clearAuth, apiFetch } from "../../../lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

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

const BUCKET_COLOR: Record<string, { color: string; bg: string; border: string; label: string }> = {
  POSITIVE: { color: "#059669", bg: "#ecfdf5", border: "#6ee7b7", label: "POSITIVE" },
  AVERAGE:  { color: "#294973", bg: "rgba(28,77,140,0.08)", border: "rgba(28,77,140,0.25)", label: "NEUTRAL" },
  NEGATIVE: { color: "#BF463B", bg: "rgba(217,58,43,0.08)", border: "rgba(217,58,43,0.25)", label: "NEGATIVE" },
};

interface FeedEntry {
  capture_id: string;
  session_id: string;
  batch_name: string;
  started_at: string;
  captured_at: string | null;
  dominant_emotion: string | null;
  rating_bucket: string | null;
  duration_seconds: number | null;
  status: "IN_PROGRESS" | "COMPLETE";
}

interface SessionInfo {
  id: string;
  workshop_id: string;
  batch_name: string;
  started_at: string;
  ended_at: string | null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function elapsed(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m ago`;
}

export default function LiveSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const auth   = getAuth();

  const [session,   setSession]   = useState<SessionInfo | null>(null);
  const [feed,      setFeed]      = useState<FeedEntry[]>([]);
  const [newIds,    setNewIds]    = useState<Set<string>>(new Set());
  const [tick,      setTick]      = useState(0);
  const seenRef    = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef2   = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { if (!getAuth()) router.push("/login"); }, [router]);

  // Load session info once
  useEffect(() => {
    apiFetch(`${API}/sessions/${sessionId}`)
      .then(r => r.json())
      .then(setSession)
      .catch(() => {});
  }, [sessionId]);

  // Poll feed every 2 seconds
  const loadFeed = useCallback(async () => {
    try {
      const res = await apiFetch(`${API}/sessions/${sessionId}/feed`);
      if (!res.ok) return;
      const data: FeedEntry[] = await res.json();
      const fresh = data.filter(e => !seenRef.current.has(e.capture_id));
      if (fresh.length > 0) {
        const freshIds = new Set(fresh.map(e => e.capture_id));
        fresh.forEach(e => seenRef.current.add(e.capture_id));
        setNewIds(prev => new Set([...prev, ...freshIds]));
        setTimeout(() => setNewIds(prev => {
          const next = new Set(prev);
          freshIds.forEach(id => next.delete(id));
          return next;
        }), 2500);
      }
      setFeed(data);
    } catch { /* offline */ }
  }, [sessionId]);

  useEffect(() => {
    loadFeed();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(loadFeed, 2000);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [loadFeed]);

  // Tick every second to keep "X ago" labels fresh
  useEffect(() => {
    tickRef2.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => { if (tickRef2.current) clearInterval(tickRef2.current); };
  }, []);

  const completed   = feed.filter(f => f.status === "COMPLETE");
  const inProgress  = feed.filter(f => f.status === "IN_PROGRESS");
  const positive    = completed.filter(f => f.rating_bucket === "POSITIVE").length;
  const average     = completed.filter(f => f.rating_bucket === "AVERAGE").length;
  const negative    = completed.filter(f => f.rating_bucket === "NEGATIVE").length;
  const total       = completed.length;

  function pct(n: number) { return total === 0 ? 0 : Math.round((n / total) * 100); }

  return (
    <div style={{ background: "var(--bg-primary)", minHeight: "100vh" }}>

      {/* ── HEADER ── */}
      <header style={{
        background: "var(--bg-white)", borderBottom: "2px solid var(--border)",
        padding: "0 40px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        boxShadow: "var(--shadow-sm)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href={session ? `/admin/workshop/${session.workshop_id}` : "/admin"} className="btn btn-secondary" style={{ fontSize: 10, padding: "6px 12px" }}>← BACK</Link>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="animate-pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, color: "var(--text-heading)" }}>
                LIVE SESSION — {session?.batch_name?.toUpperCase() ?? sessionId.slice(0, 8).toUpperCase()}
              </span>
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              {sessionId.toUpperCase()} {session?.started_at ? `· STARTED ${formatTime(session.started_at)}` : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {inProgress.length > 0 && (
            <span className="badge badge-average" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#294973", display: "inline-block" }} />
              {inProgress.length} IN PROGRESS
            </span>
          )}
          <span className="badge badge-brand">{total} RESPONSES</span>
          {auth && <span className={`badge ${auth.role === "admin" ? "badge-negative" : "badge-positive"}`}>{auth.role.toUpperCase()}</span>}
          {auth && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{auth.username}</span>}
          <button onClick={() => { clearAuth(); router.push("/login"); }} className="btn btn-secondary" style={{ fontSize: 10, padding: "5px 12px" }}>LOGOUT</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* ── LIVE STATS ROW ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
          {[
            { label: "Total", value: total,    color: "var(--brand)" },
            { label: "Positive",  value: positive,  color: "#059669" },
            { label: "Neutral",   value: average,   color: "#294973" },
            { label: "Negative",  value: negative,  color: "#D93A2B" },
          ].map(({ label, value, color }) => (
            <div key={label} className="card" style={{ textAlign: "center", padding: "20px 16px" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── SENTIMENT BARS ── */}
        {total > 0 && (
          <div className="card" style={{ marginBottom: 28, padding: "20px 24px" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 700, letterSpacing: "0.3em", color: "var(--text-muted)", marginBottom: 16 }}>SENTIMENT SPLIT</div>
            <div style={{ display: "flex", height: 28, borderRadius: 8, overflow: "hidden", gap: 2 }}>
              {[
                { pct: pct(positive), color: "#1C4D8C" },
                { pct: pct(average),  color: "#294973" },
                { pct: pct(negative), color: "#D93A2B" },
              ].map((seg, i) => seg.pct > 0 && (
                <div key={i} style={{
                  width: `${seg.pct}%`, background: seg.color,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-heading)", fontSize: 10, fontWeight: 700, color: "#fff",
                  transition: "width 0.6s ease",
                }}>
                  {seg.pct >= 10 ? `${seg.pct}%` : ""}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
              {[
                { label: "POSITIVE", count: positive, color: "#1C4D8C" },
                { label: "NEUTRAL",  count: average,  color: "#294973" },
                { label: "NEGATIVE", count: negative, color: "#D93A2B" },
              ].map(({ label, count, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
                  <span style={{ fontFamily: "var(--font-heading)", fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.15em" }}>{label} ({count})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LIVE FEED ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 24, height: 2, background: "var(--brand)", display: "inline-block" }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.3em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                LIVE FEED
              </span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
              UPDATES EVERY 2s · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>

          {feed.length === 0 ? (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, letterSpacing: "0.2em", color: "var(--text-muted)" }}>
                WAITING FOR STUDENTS…
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--text-muted)", marginTop: 6 }}>
                Share the kiosk URL with students to begin
              </div>
            </div>
          ) : (
            <div>
              {feed.map((entry, idx) => {
                const isNew  = newIds.has(entry.capture_id);
                const bucket = entry.rating_bucket ? BUCKET_COLOR[entry.rating_bucket] : null;
                return (
                  <div key={entry.capture_id} style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr 140px 130px 140px 80px",
                    alignItems: "center",
                    padding: "14px 24px",
                    borderBottom: "1px solid var(--border)",
                    background: isNew
                      ? "rgba(28,77,140,0.06)"
                      : entry.status === "IN_PROGRESS"
                        ? "rgba(28,77,140,0.02)"
                        : "transparent",
                    transition: "background 0.6s ease",
                    animation: isNew ? "slide-up 0.35s ease-out forwards" : "none",
                  }}>
                    {/* # */}
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                      #{feed.length - idx}
                    </div>

                    {/* Emotion + name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 24 }}>
                        {entry.dominant_emotion
                          ? (EMOTION_DISPLAY[entry.dominant_emotion]?.emoji ?? "🙂")
                          : "⏳"}
                      </span>
                      <div>
                        <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, color: "var(--text-heading)", textTransform: "capitalize", letterSpacing: "0.05em" }}>
                          {entry.dominant_emotion
                            ? (EMOTION_DISPLAY[entry.dominant_emotion]?.label ?? entry.dominant_emotion)
                            : "Capturing…"}
                          {isNew && <span style={{ marginLeft: 8, fontFamily: "var(--font-heading)", fontSize: 9, letterSpacing: "0.2em", color: "var(--brand)", background: "rgba(28,77,140,0.12)", borderRadius: 4, padding: "2px 6px" }}>NEW</span>}
                        </div>
                        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{entry.batch_name}</div>
                      </div>
                    </div>

                    {/* Time */}
                    <div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-heading)" }}>{formatTime(entry.started_at)}</div>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{elapsed(entry.started_at)}</div>
                    </div>

                    {/* Status */}
                    <div>
                      {entry.status === "IN_PROGRESS" ? (
                        <span className="badge" style={{ background: "rgba(28,77,140,0.08)", borderColor: "rgba(28,77,140,0.25)", color: "#294973", display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <span className="animate-pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "#294973", display: "inline-block" }} />
                          IN PROGRESS
                        </span>
                      ) : entry.dominant_emotion === "face_not_detected" ? (
                        <span className="badge" style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#9ca3af" }}>SKIPPED</span>
                      ) : (
                        <span className="badge" style={{ background: "#ecfdf5", borderColor: "#6ee7b7", color: "#059669" }}>COMPLETE</span>
                      )}
                    </div>

                    {/* Rating */}
                    <div>
                      {bucket ? (
                        <span className="badge" style={{ background: bucket.bg, borderColor: bucket.border, color: bucket.color }}>
                          {bucket.label}
                        </span>
                      ) : entry.dominant_emotion === "face_not_detected" ? (
                        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>SKIPPED</span>
                      ) : (
                        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>—</span>
                      )}
                    </div>

                    {/* Duration */}
                    <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                      {entry.duration_seconds !== null ? `${entry.duration_seconds}s` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAuth, clearAuth, apiFetch } from "../../../lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

// Collapsed to 3 sentiment categories — internal 7-class model maps here for display
const SENTIMENT: Record<string, { emoji: string; label: string; color: string }> = {
  POSITIVE: { emoji: "😊", label: "HAPPY",   color: "#059669" },
  NEUTRAL:  { emoji: "😐", label: "NEUTRAL", color: "#294973" },
  NEGATIVE: { emoji: "😔", label: "SAD",     color: "#D93A2B" },
};

function sentimentOf(emotion: string | null, bucket: string | null) {
  if (!emotion) return null;
  if (emotion === "face_not_detected") return null;
  if (bucket) return SENTIMENT[bucket] ?? null;
  if (["happy", "surprise"].includes(emotion)) return SENTIMENT.POSITIVE;
  if (emotion === "neutral") return SENTIMENT.NEUTRAL;
  return SENTIMENT.NEGATIVE;
}

const BUCKET_COLOR: Record<string, { color: string; bg: string; border: string; label: string }> = {
  POSITIVE: { color: "#059669", bg: "#ecfdf5", border: "#6ee7b7", label: "HAPPY" },
  AVERAGE:  { color: "#294973", bg: "rgba(28,77,140,0.08)", border: "rgba(28,77,140,0.25)", label: "NEUTRAL" },
  NEGATIVE: { color: "#BF463B", bg: "rgba(217,58,43,0.08)", border: "rgba(217,58,43,0.25)", label: "SAD" },
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
  face_count: number;
  star_rating: number | null;
  status: "IN_PROGRESS" | "COMPLETE";
}

interface SessionInfo {
  id: string;
  workshop_id: string;
  batch_name: string;
  started_at: string;
  ended_at: string | null;
}

const IST = { timeZone: "Asia/Kolkata" };

function formatTime(iso: string) {
  return new Date(iso + "Z").toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function elapsed(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso + "Z").getTime()) / 1000);
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
  const [feedPage,  setFeedPage]  = useState(0);
  const FEED_PER_PAGE = 10;
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
        setFeedPage(0); // jump to page 1 so newest entries are visible
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
      <header style={{ background: "var(--bg-white)", borderBottom: "2px solid var(--border)", padding: "10px 24px", boxShadow: "var(--shadow-sm)" }} className="admin-header">
        <div className="admin-header-left">
          <Link href={session ? `/admin/workshop/${session.workshop_id}` : "/admin"} className="btn btn-secondary" style={{ fontSize: 10, padding: "6px 12px", whiteSpace: "nowrap" }}>← BACK</Link>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="animate-pulse-dot" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(11px, 2.5vw, 15px)", fontWeight: 700, color: "var(--text-heading)" }}>
                LIVE — {session?.batch_name?.toUpperCase() ?? sessionId.slice(0, 8).toUpperCase()}
              </span>
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
              {sessionId.slice(0, 8).toUpperCase()} {session?.started_at ? `· ${formatTime(session.started_at)}` : ""}
            </div>
          </div>
        </div>
        <div className="admin-header-right">
          {inProgress.length > 0 && (
            <span className="badge badge-average" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span className="animate-pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: "#294973", display: "inline-block" }} />
              {inProgress.length} ACTIVE
            </span>
          )}
          <span className="badge badge-brand">{total} RESP</span>
          {auth && <span className={`badge ${auth.role === "admin" ? "badge-negative" : "badge-positive"}`}>{auth.role.toUpperCase()}</span>}
          {auth && <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }} className="hide-mobile">{auth.username}</span>}
          <button onClick={() => { clearAuth(); router.push("/login"); }} className="btn btn-secondary" style={{ fontSize: 10, padding: "5px 12px" }}>LOGOUT</button>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(16px, 4vw, 32px) clamp(12px, 3vw, 24px)" }}>

        {/* ── LIVE STATS ROW ── */}
        <div className="grid-4col" style={{ marginBottom: 28 }}>
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
        <div className="card tbl-wrap" style={{ padding: 0, overflow: "hidden" }}>
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
          ) : (() => {
            const totalPages = Math.ceil(feed.length / FEED_PER_PAGE);
            const safePage   = Math.min(feedPage, totalPages - 1);
            const pagedFeed  = feed.slice(safePage * FEED_PER_PAGE, (safePage + 1) * FEED_PER_PAGE);
            return (
              <>
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  {pagedFeed.map((entry, idx) => {
                    const globalIdx = safePage * FEED_PER_PAGE + idx;
                    const isNew     = newIds.has(entry.capture_id);
                    const sentiment = sentimentOf(entry.dominant_emotion, entry.rating_bucket);
                    const skipped   = entry.dominant_emotion === "face_not_detected";
                    return (
                      <div key={entry.capture_id} style={{
                        display: "grid",
                        gridTemplateColumns: "36px 1fr 56px 110px 120px 90px 72px",
                        alignItems: "center",
                        padding: "12px 20px",
                        borderBottom: "1px solid var(--border)",
                        minWidth: 560,
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
                          #{feed.length - globalIdx}
                        </div>

                        {/* Sentiment emoji + label + batch */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 24 }}>
                            {entry.status === "IN_PROGRESS" ? "⏳" : skipped ? "😶" : (sentiment?.emoji ?? "🙂")}
                          </span>
                          <div>
                            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: sentiment ? sentiment.color : "var(--text-muted)" }}>
                              {entry.status === "IN_PROGRESS"
                                ? "CAPTURING…"
                                : skipped ? "NO FACE"
                                : (sentiment?.label ?? "—")}
                              {isNew && <span style={{ marginLeft: 8, fontFamily: "var(--font-heading)", fontSize: 9, letterSpacing: "0.2em", color: "var(--brand)", background: "rgba(28,77,140,0.12)", borderRadius: 4, padding: "2px 6px" }}>NEW</span>}
                            </div>
                            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--text-muted)" }}>{entry.batch_name}</div>
                          </div>
                        </div>

                        {/* Faces count */}
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 14 }}>👤</span>
                          <span style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, color: entry.face_count > 1 ? "var(--brand)" : "var(--text-muted)" }}>
                            {entry.face_count ?? 1}
                          </span>
                        </div>

                        {/* Status */}
                        <div>
                          {entry.status === "IN_PROGRESS" ? (
                            <span className="badge" style={{ background: "rgba(28,77,140,0.08)", borderColor: "rgba(28,77,140,0.25)", color: "#294973", display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <span className="animate-pulse-dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "#294973", display: "inline-block" }} />
                              IN PROGRESS
                            </span>
                          ) : skipped ? (
                            <span className="badge" style={{ background: "#f3f4f6", borderColor: "#d1d5db", color: "#9ca3af" }}>SKIPPED</span>
                          ) : (
                            <span className="badge" style={{ background: "#ecfdf5", borderColor: "#6ee7b7", color: "#059669" }}>COMPLETE</span>
                          )}
                        </div>

                        {/* Rating */}
                        <div>
                          {sentiment ? (
                            <span className="badge" style={{
                              background: sentiment.color === "#059669" ? "#ecfdf5" : sentiment.color === "#294973" ? "rgba(41,73,115,0.08)" : "rgba(217,58,43,0.08)",
                              borderColor: sentiment.color === "#059669" ? "#6ee7b7" : sentiment.color === "#294973" ? "rgba(41,73,115,0.3)" : "rgba(217,58,43,0.3)",
                              color: sentiment.color,
                            }}>
                              {sentiment.label}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>—</span>
                          )}
                        </div>

                        {/* Stars */}
                        <div style={{ textAlign: "center" }}>
                          {entry.star_rating ? (
                            <span style={{ fontSize: 13, color: "#d97706", letterSpacing: 1 }}>
                              {"★".repeat(entry.star_rating)}
                              <span style={{ opacity: 0.25 }}>{"★".repeat(5 - entry.star_rating)}</span>
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>—</span>
                          )}
                        </div>

                        {/* Captured time */}
                        <div style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                          {entry.captured_at ? new Date(entry.captured_at + "Z").toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* ── Pagination bar ── */}
                {totalPages > 1 && (
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 20px", borderTop: "1px solid var(--border)",
                    background: "#fafafa",
                  }}>
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "var(--text-muted)" }}>
                      PAGE {safePage + 1} / {totalPages} &nbsp;·&nbsp; {feed.length} TOTAL
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setFeedPage(p => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        className="btn btn-secondary"
                        style={{ fontSize: 10, padding: "5px 14px", opacity: safePage === 0 ? 0.4 : 1 }}
                      >← PREV</button>
                      <button
                        onClick={() => setFeedPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={safePage >= totalPages - 1}
                        className="btn btn-primary"
                        style={{ fontSize: 10, padding: "5px 14px", opacity: safePage >= totalPages - 1 ? 0.4 : 1 }}
                      >NEXT →</button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

      </main>
    </div>
  );
}

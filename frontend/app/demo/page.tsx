"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const EMOTION_META: Record<string, { emoji: string; color: string; bg: string; label: string }> = {
  happy:   { emoji: "😄", color: "#059669", bg: "rgba(5,150,105,0.18)",  label: "HAPPY"   },
  neutral: { emoji: "😐", color: "#294973", bg: "rgba(41,73,115,0.18)",  label: "NEUTRAL" },
  sad:     { emoji: "😢", color: "#1C4D8C", bg: "rgba(28,77,140,0.18)",  label: "SAD"     },
  angry:   { emoji: "😠", color: "#D93A2B", bg: "rgba(217,58,43,0.18)",  label: "ANGRY"   },
};

// Map raw model labels → our 4 display emotions
function simplifyEmotion(raw: string): string {
  if (raw === "happy" || raw === "surprise")                      return "happy";
  if (raw === "angry" || raw === "disgust" || raw === "contempt") return "angry";
  if (raw === "sad"   || raw === "fear")                          return "sad";
  return "neutral";
}

const BAR_ORDER = ["happy", "neutral", "sad", "angry"];

interface EmotionScores {
  happy: number; neutral: number; angry: number;
  sad: number; surprise: number; fear: number; disgust: number;
}

interface DemoResult {
  dominant_emotion: string;
  rating_bucket: string | null;
  emotions: EmotionScores;
}

export default function DemoPage() {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const processingRef = useRef(false);

  const [result,   setResult]   = useState<DemoResult | null>(null);
  const [fps,      setFps]      = useState(0);
  const [frameMs,  setFrameMs]  = useState(0);
  const [camReady, setCamReady] = useState(false);
  const [error,    setError]    = useState("");

  // Start camera
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    }).then(stream => {
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().then(() => setCamReady(true));
      }
    }).catch(() => setError("Camera access denied — please allow camera and refresh."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Poll backend every 1.2s
  const analyse = useCallback(async () => {
    if (processingRef.current) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    processingRef.current = true;
    const t0 = performance.now();

    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) { processingRef.current = false; return; }
      const form = new FormData();
      form.append("image", blob, "frame.jpg");
      try {
        const res = await fetch("/api/demo", { method: "POST", body: form });
        if (res.ok) {
          const data: DemoResult = await res.json();
          setResult(data);
          const ms = Math.round(performance.now() - t0);
          setFrameMs(ms);
          setFps(Math.round(1000 / ms));
        }
      } catch { /* backend busy */ }
      processingRef.current = false;
    }, "image/jpeg", 0.85);
  }, []);

  useEffect(() => {
    if (!camReady) return;
    timerRef.current = setInterval(analyse, 1200);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [camReady, analyse]);

  const rawDominant  = result?.dominant_emotion;
  const dominant     = rawDominant && rawDominant !== "face_not_detected" ? simplifyEmotion(rawDominant) : rawDominant;
  const meta         = dominant && dominant !== "face_not_detected" ? EMOTION_META[dominant] : null;
  const scores       = result?.emotions;

  // Merge 7 model scores into 4 buckets
  const mergedScores = scores ? {
    happy:   (scores.happy   ?? 0) + (scores.surprise ?? 0),
    neutral: (scores.neutral ?? 0),
    sad:     (scores.sad     ?? 0) + (scores.fear     ?? 0),
    angry:   (scores.angry   ?? 0) + (scores.disgust  ?? 0),
  } : null;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── HEADER ── */}
      <header style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px",
        background: "rgba(10,10,15,0.85)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: camReady ? "#059669" : "#d97706" }} className={camReady ? "animate-pulse-dot" : ""} />
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 700, letterSpacing: "0.25em", color: "#fff" }}>
            LIVE EMOTION DETECTOR
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {frameMs > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
              {frameMs}ms · {fps} fps
            </span>
          )}
          <a href="/admin" style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "rgba(255,255,255,0.4)", textDecoration: "none" }}>
            ← PORTAL
          </a>
        </div>
      </header>

      {/* ── CAMERA ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0 }}>
        <video
          ref={videoRef}
          muted playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", opacity: camReady ? 1 : 0, transition: "opacity 0.5s" }}
        />
        {/* dark vignette */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
      </div>

      {/* ── MAIN OVERLAY ── */}
      <div style={{ position: "fixed", inset: 0, zIndex: 10, display: "flex", alignItems: "flex-end", padding: "0 0 32px 0" }}>

        {/* LEFT — big emotion display */}
        <div style={{ flex: 1, padding: "0 32px" }}>
          {error ? (
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 14, color: "#D93A2B", letterSpacing: "0.15em" }}>{error}</div>
          ) : !camReady ? (
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.2em" }}>STARTING CAMERA…</div>
          ) : dominant === "face_not_detected" ? (
            <div>
              <div style={{ fontSize: 64, marginBottom: 8 }}>😶</div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 900, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em" }}>
                NO FACE DETECTED
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>
                Move closer or improve lighting
              </div>
            </div>
          ) : meta ? (
            <div>
              <div style={{
                display: "inline-block",
                background: meta.bg,
                border: `2px solid ${meta.color}`,
                borderRadius: 20, padding: "10px 20px", marginBottom: 12,
                backdropFilter: "blur(8px)",
              }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 11, fontWeight: 700, letterSpacing: "0.3em", color: meta.color }}>
                  {result?.rating_bucket ?? ""}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <span style={{ fontSize: 96, lineHeight: 1, filter: "drop-shadow(0 0 30px rgba(255,255,255,0.3))" }}>
                  {meta.emoji}
                </span>
                <div>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 52, fontWeight: 900, color: "#fff", letterSpacing: "0.06em", lineHeight: 1, textShadow: `0 0 40px ${meta.color}` }}>
                    {meta.label}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 6 }}>
                    {mergedScores ? `${Math.round(Math.max(...Object.values(mergedScores)))}% confidence` : ""}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 12, color: "rgba(255,255,255,0.3)", letterSpacing: "0.2em" }}>
              ANALYSING…
            </div>
          )}
        </div>

        {/* RIGHT — emotion bars */}
        {mergedScores && dominant !== "face_not_detected" && (
          <div style={{
            width: 260, marginRight: 32,
            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(16px)",
            borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)",
            padding: "18px 20px",
          }}>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 9, fontWeight: 700, letterSpacing: "0.3em", color: "rgba(255,255,255,0.35)", marginBottom: 14 }}>
              EMOTION SCORES
            </div>
            {BAR_ORDER.map(key => {
              const m    = EMOTION_META[key];
              const pct  = Math.round((mergedScores as Record<string, number>)[key] ?? 0);
              const isTop = key === dominant;
              return (
                <div key={key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{
                      fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.15em",
                      color: isTop ? m.color : "rgba(255,255,255,0.45)",
                      fontWeight: isTop ? 700 : 400,
                    }}>
                      {m.emoji} {m.label}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: isTop ? m.color : "rgba(255,255,255,0.3)" }}>
                      {pct}%
                    </span>
                  </div>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: isTop ? m.color : "rgba(255,255,255,0.2)",
                      borderRadius: 3,
                      transition: "width 0.4s ease",
                      boxShadow: isTop ? `0 0 8px ${m.color}` : "none",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── CENTER GUIDE (no result yet) ── */}
      {!result && camReady && (
        <div style={{ position: "fixed", inset: 0, zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ position: "relative", width: 280, height: 340 }}>
            {[
              { top: 0,    left: 0,  borderTop: "3px solid rgba(255,255,255,0.25)", borderLeft: "3px solid rgba(255,255,255,0.25)" },
              { top: 0,    right: 0, borderTop: "3px solid rgba(255,255,255,0.25)", borderRight: "3px solid rgba(255,255,255,0.25)" },
              { bottom: 0, left: 0,  borderBottom: "3px solid rgba(255,255,255,0.25)", borderLeft: "3px solid rgba(255,255,255,0.25)" },
              { bottom: 0, right: 0, borderBottom: "3px solid rgba(255,255,255,0.25)", borderRight: "3px solid rgba(255,255,255,0.25)" },
            ].map((s, i) => (
              <div key={i} style={{ position: "absolute", width: 40, height: 40, ...s }} />
            ))}
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 11, letterSpacing: "0.25em", color: "rgba(255,255,255,0.4)" }}>
                FACE CAMERA
              </span>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

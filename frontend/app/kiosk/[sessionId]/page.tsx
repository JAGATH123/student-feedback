"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type KioskState = "welcome" | "consent" | "scanning" | "face_detected" | "analyzing" | "result" | "no_face" | "error";


export default function KioskPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const videoRef      = useRef<HTMLVideoElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const detectorRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceApiLoaded = useRef(false);
  const countRef      = useRef(3);

  const [state,      setState]      = useState<KioskState>("welcome");
  const [captureId,  setCaptureId]  = useState<string | null>(null);
  const [errorMsg,   setErrorMsg]   = useState("");
  const [faceBoxes,  setFaceBoxes]  = useState<Array<{ x: number; y: number; w: number; h: number }>>([]);
  const [countdown,  setCountdown]  = useState(3);

  // ── stop camera + detection loop ─────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (detectorRef.current) { clearInterval(detectorRef.current); detectorRef.current = null; }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setFaceBoxes([]);
  }, []);

  // ── load tiny face detector model ────────────────────────────────────────────
  async function loadFaceApi() {
    if (faceApiLoaded.current) return true;
    try {
      const faceapi = await import("face-api.js");
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      faceApiLoaded.current = true;
      return true;
    } catch {
      return false;
    }
  }

  // ── open camera, poll face detection ─────────────────────────────────────────
  useEffect(() => {
    if (state !== "scanning") return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const ok = await loadFaceApi();
        if (!ok || cancelled) return;

        const faceapi = await import("face-api.js");

        detectorRef.current = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;

          const results = await faceapi.detectAllFaces(
            video,
            new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.3 }),
          );

          if (results.length > 0) {
            setFaceBoxes(results.map(r => ({ x: r.box.x, y: r.box.y, w: r.box.width, h: r.box.height })));
            if (detectorRef.current) { clearInterval(detectorRef.current); detectorRef.current = null; }
            setState("face_detected");
          } else {
            setFaceBoxes([]);
          }
        }, 200);

      } catch {
        if (!cancelled) {
          setErrorMsg("Camera access denied. Please allow camera access and try again.");
          setState("error");
        }
      }
    }

    start();
    return () => { cancelled = true; };
  }, [state]);

  // ── countdown after face detected ────────────────────────────────────────────
  useEffect(() => {
    if (state !== "face_detected") return;
    countRef.current = 3;
    setCountdown(3);

    const tick = setInterval(() => {
      countRef.current -= 1;
      setCountdown(countRef.current);
      if (countRef.current <= 0) {
        clearInterval(tick);
        snap();
      }
    }, 1000);

    return () => clearInterval(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── snap frame and analyse ────────────────────────────────────────────────────
  async function snap() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setErrorMsg("Camera not ready. Please try again.");
      setState("error");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);

    stopCamera();
    setState("analyzing");

    canvas.toBlob(async (blob) => {
      if (!blob) { setErrorMsg("Could not capture image."); setState("error"); return; }

      const form = new FormData();
      form.append("image",      blob, "capture.jpg");
      form.append("capture_id", captureId ?? "");

      try {
        const res  = await fetch(`${API}/api/capture`, { method: "POST", body: form });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.dominant_emotion === "face_not_detected") {
          setState("no_face");
          setTimeout(autoRestart, 3500);
        } else {
          setState("result");
          setTimeout(autoRestart, 3000);
        }
      } catch {
        setErrorMsg("Analysis failed. Please try again.");
        setState("error");
      }
    }, "image/jpeg", 0.92);
  }

  // ── auto-restart: skip welcome, go straight to camera for next student ────────
  async function autoRestart() {
    setErrorMsg(""); setFaceBoxes([]);
    try {
      const form = new FormData();
      form.append("session_id", sessionId);
      const res = await fetch(`${API}/api/start`, { method: "POST", body: form });
      if (res.ok) setCaptureId((await res.json()).capture_id);
    } catch { /* non-blocking */ }
    setState("scanning");
  }

  // ── tap to begin ─────────────────────────────────────────────────────────────
  async function handleBegin() {
    setState("consent");
    try {
      const form = new FormData();
      form.append("session_id", sessionId);
      const res = await fetch(`${API}/api/start`, { method: "POST", body: form });
      if (res.ok) setCaptureId((await res.json()).capture_id);
    } catch { /* non-blocking */ }
  }

  function reset() {
    stopCamera();
    setErrorMsg(""); setCaptureId(null); setFaceBoxes([]);
    setState("welcome");
  }

  useEffect(() => () => stopCamera(), [stopCamera]);

  const isCamera = state === "scanning" || state === "face_detected";

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-primary)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      userSelect: "none", overflow: "hidden",
    }}>

      {/* ── HEADER (non-camera screens) ── */}
      {!isCamera && state !== "analyzing" && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 56, zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px",
          background: "var(--bg-white)", borderBottom: "2px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 8px var(--brand)" }} className="animate-pulse-dot" />
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-heading)", textTransform: "uppercase" }}>EMOTION KIOSK</span>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
            SESSION {sessionId.slice(0, 8).toUpperCase()}
          </span>
        </div>
      )}

      {/* ══ WELCOME ══════════════════════════════════════════════════════════════ */}
      {state === "welcome" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 520, padding: "0 24px" }}>
          <div style={{ fontSize: 72, marginBottom: 20 }}>👋</div>
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 38, fontWeight: 900, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: 1.2, marginBottom: 10 }}>
            How did the<br /><span style={{ color: "var(--brand)" }}>workshop</span> feel?
          </h1>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 19, color: "var(--text-secondary)", marginBottom: 36 }}>
            Look at the camera — we detect your reaction live.
          </p>
          <button
            onClick={handleBegin}
            style={{ fontFamily: "var(--font-heading)", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: "var(--brand)", color: "#fff", border: "2px solid var(--brand)", borderRadius: "var(--radius-lg)", padding: "20px 64px", cursor: "pointer", width: "100%", boxShadow: "var(--brand-glow)", transition: "all 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--brand-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--brand)")}
          >
            TAP TO BEGIN
          </button>
        </div>
      )}

      {/* ══ CONSENT ══════════════════════════════════════════════════════════════ */}
      {state === "consent" && (
        <div className="animate-slide-up" style={{ maxWidth: 560, width: "100%", padding: "0 24px" }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>📷</div>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Live emotion scan
            </h2>
          </div>
          <div className="card" style={{ marginBottom: 20 }}>
            {[
              ["✅", "Your camera is used live to detect your facial expression."],
              ["✅", "No video is recorded or stored — only the emotion label."],
              ["✅", "Capture is automatic once your face is detected."],
              ["✅", "Your response is completely anonymous."],
            ].map(([icon, text]) => (
              <div key={text as string} style={{ display: "flex", gap: 12, marginBottom: 12, fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 500, color: "var(--text-secondary)" }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={reset} className="btn btn-secondary" style={{ flex: 1, padding: "16px", fontSize: 12 }}>SKIP</button>
            <button onClick={() => setState("scanning")} className="btn btn-primary" style={{ flex: 3, padding: "16px", fontSize: 14 }}>
              I AGREE — START SCAN →
            </button>
          </div>
        </div>
      )}

      {/* ══ FULL-SCREEN CAMERA (scanning + face_detected) ═════════════════════════ */}
      {isCamera && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 20 }}>

          {/* full-screen mirrored video */}
          <video
            ref={videoRef}
            muted playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
          />

          {/* face bounding boxes overlay — one rect per detected person */}
          {faceBoxes.length > 0 && videoRef.current && (
            <svg
              viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`}
              preserveAspectRatio="xMidYMid slice"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", transform: "scaleX(-1)" }}
            >
              {faceBoxes.map((box, i) => (
                <rect
                  key={i}
                  x={box.x} y={box.y}
                  width={box.w} height={box.h}
                  fill="none"
                  stroke={state === "face_detected" ? "#1C4D8C" : "rgba(255,255,255,0.7)"}
                  strokeWidth="4"
                  rx="10"
                  style={{ filter: state === "face_detected" ? "drop-shadow(0 0 10px #1C4D8C)" : "none", transition: "stroke 0.2s" }}
                />
              ))}
              {state === "face_detected" && faceBoxes[0] && (
                <text
                  x={faceBoxes[0].x + faceBoxes[0].w / 2}
                  y={Math.max(30, faceBoxes[0].y - 14)}
                  textAnchor="middle"
                  fill="#1C4D8C"
                  fontSize="22"
                  fontFamily="Orbitron, sans-serif"
                  fontWeight="700"
                  style={{ filter: "drop-shadow(0 0 6px rgba(28,77,140,0.8))" }}
                >
                  ✓ {faceBoxes.length > 1 ? `${faceBoxes.length} FACES` : "FACE"} DETECTED
                </text>
              )}
            </svg>
          )}

          {/* top bar */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 64, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", background: "linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)", zIndex: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#1C4D8C", boxShadow: "0 0 8px #1C4D8C" }} className="animate-pulse-dot" />
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "0.2em", color: "#fff", textTransform: "uppercase" }}>EMOTION KIOSK</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              SESSION {sessionId.slice(0, 8).toUpperCase()}
            </span>
          </div>

          {/* bottom instruction */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "32px 24px 52px", background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)", zIndex: 2, textAlign: "center" }}>
            {state === "scanning" && (
              <>
                {faceBoxes.length === 0 && (
                  <>
                    <p style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 700, letterSpacing: "0.25em", color: "rgba(255,255,255,0.9)", textTransform: "uppercase", marginBottom: 8 }}>
                      POSITION YOUR FACE IN THE FRAME
                    </p>
                    <p style={{ fontFamily: "var(--font-body)", fontSize: 15, color: "rgba(255,255,255,0.45)" }}>
                      Capture is automatic once a face is detected
                    </p>
                  </>
                )}
                {faceBoxes.length > 0 && (
                  <p style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 700, letterSpacing: "0.25em", color: "#1C4D8C", textTransform: "uppercase" }}>
                    {faceBoxes.length > 1 ? `${faceBoxes.length} FACES` : "FACE"} DETECTED…
                  </p>
                )}
              </>
            )}

            {state === "face_detected" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div
                  key={countdown}
                  className="animate-count-pop"
                  style={{ fontFamily: "var(--font-heading)", fontSize: 96, fontWeight: 900, color: "#fff", lineHeight: 1, textShadow: "0 0 40px rgba(28,77,140,0.9)" }}
                >
                  {countdown}
                </div>
                <p style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 700, letterSpacing: "0.3em", color: "#fff", textTransform: "uppercase" }}>
                  HOLD STILL &amp; SMILE!
                </p>
              </div>
            )}
          </div>

          {/* corner guide brackets — only when no faces in view */}
          {state === "scanning" && faceBoxes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 1 }}>
              <div style={{ position: "relative", width: "clamp(200px, 40vw, 340px)", aspectRatio: "3/4" }}>
                {[
                  { top: 0,    left: 0,  borderTop:    "3px solid rgba(28,77,140,0.7)", borderLeft:   "3px solid rgba(28,77,140,0.7)" },
                  { top: 0,    right: 0, borderTop:    "3px solid rgba(28,77,140,0.7)", borderRight:  "3px solid rgba(28,77,140,0.7)" },
                  { bottom: 0, left: 0,  borderBottom: "3px solid rgba(28,77,140,0.7)", borderLeft:   "3px solid rgba(28,77,140,0.7)" },
                  { bottom: 0, right: 0, borderBottom: "3px solid rgba(28,77,140,0.7)", borderRight:  "3px solid rgba(28,77,140,0.7)" },
                ].map((s, i) => (
                  <div key={i} style={{ position: "absolute", width: 36, height: 36, ...s }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ ANALYSING ════════════════════════════════════════════════════════════ */}
      {state === "analyzing" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 72, height: 72, margin: "0 auto 24px", border: "4px solid var(--border)", borderTop: "4px solid var(--brand)", borderRadius: "50%" }} className="animate-spin-slow" />
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 700, color: "var(--text-heading)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>ANALYSING</h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, color: "var(--text-muted)" }}>Analysing your expression…</p>
        </div>
      )}

      {/* ══ RESULT ═══════════════════════════════════════════════════════════════ */}
      {state === "result" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 460, padding: "0 24px" }}>
          <div style={{ fontSize: 76, marginBottom: 20 }}>🙏</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 44, fontWeight: 900, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            THANK YOU!
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 18, color: "var(--text-secondary)", marginBottom: 24 }}>
            Your feedback has been recorded.
          </p>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            NEXT STUDENT IN A MOMENT…
          </p>
        </div>
      )}

      {/* ══ NO FACE ══════════════════════════════════════════════════════════════ */}
      {state === "no_face" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 460, padding: "0 24px" }}>
          <div style={{ fontSize: 72, marginBottom: 20 }}>😶</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 34, fontWeight: 900, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            FACE NOT DETECTED
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 17, color: "var(--text-secondary)", marginBottom: 24 }}>
            Please face the camera directly with good lighting and try again.
          </p>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: 10, letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            RETRYING IN A MOMENT…
          </p>
        </div>
      )}

      {/* ══ ERROR ════════════════════════════════════════════════════════════════ */}
      {state === "error" && (
        <div style={{ textAlign: "center", maxWidth: 440, padding: "0 24px" }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            SOMETHING WENT WRONG
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: 16, color: "var(--text-secondary)", marginBottom: 28 }}>{errorMsg}</p>
          <button onClick={reset} className="btn btn-primary" style={{ width: "100%", padding: "16px", fontSize: 13 }}>
            TRY AGAIN
          </button>
        </div>
      )}

    </div>
  );
}

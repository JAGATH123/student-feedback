"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

type KioskState =
  | "welcome"
  | "consent"
  | "scanning"
  | "face_detected"
  | "analyzing"
  | "gesture_scan"
  | "result"
  | "no_face"
  | "error";

// ── finger landmarks (MediaPipe 21-point hand) ───────────────────────────────
const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

function countFingers(landmarks: Array<{ x: number; y: number }>, handedness: string): number {
  let count = 0;
  // Thumb: direction flips by hand side
  const thumbExtended =
    handedness === "Right"
      ? landmarks[4].x < landmarks[3].x
      : landmarks[4].x > landmarks[3].x;
  if (thumbExtended) count++;
  // Four fingers: tip.y < pip.y means extended (y=0 is top of frame)
  for (let i = 0; i < FINGER_TIPS.length; i++) {
    if (landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y) count++;
  }
  return Math.max(1, Math.min(5, count));
}

// Star display helper
function Stars({ n, size = 24, amber = false }: { n: number; size?: number; amber?: boolean }) {
  return (
    <span style={{ fontSize: size, color: amber ? "#d97706" : "#fff", letterSpacing: 2 }}>
      {"★".repeat(n)}
      <span style={{ opacity: 0.3 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}


export default function KioskPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  // ── refs ─────────────────────────────────────────────────────────────────────
  const videoRef       = useRef<HTMLVideoElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const detectorRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const faceApiLoaded  = useRef(false);
  const countRef       = useRef(3);
  // gesture refs
  const rafRef            = useRef<number | null>(null);
  const handsRef          = useRef<any>(null);
  const stableRef         = useRef<{ ratings: number[]; frames: number }>({ ratings: [], frames: 0 });
  const gestureSubmitting = useRef(false);
  const gestureTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── state ────────────────────────────────────────────────────────────────────
  const [state,          setState]          = useState<KioskState>("welcome");
  const [captureId,      setCaptureId]      = useState<string | null>(null);
  const [errorMsg,       setErrorMsg]       = useState("");
  const [faceBoxes,      setFaceBoxes]      = useState<Array<{ x: number; y: number; w: number; h: number }>>([]);
  const [countdown,      setCountdown]      = useState(3);
  const [isMobile,       setIsMobile]       = useState(false);
  const [gestureRatings, setGestureRatings] = useState<number[]>([]);
  const [liveFingers,    setLiveFingers]    = useState<number[]>([]);

  // ── mobile detection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── stop everything ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (detectorRef.current)   { clearInterval(detectorRef.current); detectorRef.current = null; }
    if (rafRef.current)        { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (gestureTimerRef.current) { clearTimeout(gestureTimerRef.current); gestureTimerRef.current = null; }
    handsRef.current = null;           // MediaPipe Hands has no explicit close()
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setFaceBoxes([]);
  }, []);

  // ── load face-api.js ─────────────────────────────────────────────────────────
  async function loadFaceApi(): Promise<boolean> {
    if (faceApiLoaded.current) return true;
    try {
      const faceapi = await import("face-api.js");
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      faceApiLoaded.current = true;
      return true;
    } catch { return false; }
  }

  // ── load MediaPipe Hands from CDN ─────────────────────────────────────────────
  async function loadMediaPipeHands(): Promise<any> {
    return new Promise((resolve) => {
      if ((window as any).Hands) { resolve((window as any).Hands); return; }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js";
      script.crossOrigin = "anonymous";
      script.onload  = () => resolve((window as any).Hands ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  // ── start camera stream ───────────────────────────────────────────────────────
  async function startCamera(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch { return false; }
  }

  // ── useEffect: SCANNING ───────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "scanning") return;
    let cancelled = false;

    async function run() {
      const cameraOk = await startCamera();
      if (!cameraOk || cancelled) {
        if (!cancelled) { setErrorMsg("Camera access denied. Please allow camera access and try again."); setState("error"); }
        return;
      }
      const apiOk = await loadFaceApi();
      if (!apiOk || cancelled) return;

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
    }

    run();
    return () => { cancelled = true; };
  }, [state]);

  // ── useEffect: GESTURE_SCAN ───────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "gesture_scan") return;
    let cancelled = false;

    stableRef.current         = { ratings: [], frames: 0 };
    gestureSubmitting.current = false;
    setLiveFingers([]);

    async function run() {
      const cameraOk = await startCamera();
      if (!cameraOk || cancelled) {
        // Camera failed → skip gesture, go directly to thank you
        if (!cancelled) setState("result");
        return;
      }

      const HandsCtor = await loadMediaPipeHands();
      if (!HandsCtor || cancelled) {
        if (!cancelled) setState("result");
        return;
      }

      const mp_hands_url = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915";
      const hands = new HandsCtor({
        locateFile: (file: string) => `${mp_hands_url}/${file}`,
      });
      hands.setOptions({
        maxNumHands: 6,
        modelComplexity: 0,          // 0 = lite, fast enough for kiosk
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.55,
      });
      handsRef.current = hands;

      hands.onResults((results: any) => {
        if (cancelled || gestureSubmitting.current) return;

        const landmarks  = (results.multiHandLandmarks  ?? []) as Array<Array<{ x: number; y: number }>>;
        const handedness = (results.multiHandedness     ?? []) as Array<{ label: string }>;

        if (landmarks.length === 0) {
          stableRef.current = { ratings: [], frames: 0 };
          setLiveFingers([]);
          return;
        }

        const counts = landmarks.map((lm, i) => countFingers(lm, handedness[i]?.label ?? "Right"));
        setLiveFingers(counts);

        // Stability: same finger-counts for 45 consecutive frames (~1.5 s at ~30 fps)
        const prev     = stableRef.current;
        const same     = prev.ratings.length === counts.length && prev.ratings.every((v, i) => v === counts[i]);
        const newFrames = same ? prev.frames + 1 : 1;
        stableRef.current = { ratings: counts, frames: newFrames };

        if (newFrames >= 45 && !gestureSubmitting.current) {
          gestureSubmitting.current = true;
          doSubmitGesture(counts);
        }
      });

      const video = videoRef.current!;

      async function loop() {
        if (cancelled || !handsRef.current) return;
        if (video.readyState >= 2) {
          try { await hands.send({ image: video }); } catch { /* ignore mid-cleanup errors */ }
        }
        rafRef.current = requestAnimationFrame(loop);
      }

      if (video.readyState >= 2) {
        loop();
      } else {
        video.addEventListener("loadeddata", loop, { once: true });
      }

      // Safety timeout: 12 s — if nobody shows fingers, skip to result
      gestureTimerRef.current = setTimeout(() => {
        if (!cancelled && !gestureSubmitting.current) {
          gestureSubmitting.current = true;
          if (rafRef.current)     { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;
          setGestureRatings([]);
          setState("result");
        }
      }, 12_000);
    }

    run();

    return () => {
      cancelled = true;
      if (rafRef.current)          { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (gestureTimerRef.current) { clearTimeout(gestureTimerRef.current); gestureTimerRef.current = null; }
      handsRef.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── submit gesture: N hands → N DB rows ─────────────────────────────────────
  async function doSubmitGesture(fingerCounts: number[]) {
    // Stop camera immediately (shows result screen)
    if (rafRef.current)          { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (gestureTimerRef.current) { clearTimeout(gestureTimerRef.current); gestureTimerRef.current = null; }
    handsRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null;

    const saved: number[] = [];
    for (const stars of fingerCounts) {
      try {
        // Create a fresh capture row for this gesture
        const sf = new FormData();
        sf.append("session_id", sessionId);
        const sr = await fetch(`${API}/api/start`, { method: "POST", body: sf });
        if (!sr.ok) continue;
        const { capture_id: gid } = await sr.json();

        const rf = new FormData();
        rf.append("capture_id", gid);
        rf.append("star_count",  String(stars));
        await fetch(`${API}/api/gesture_rate`, { method: "POST", body: rf });

        saved.push(stars);
      } catch { /* non-blocking */ }
    }

    setGestureRatings(saved.length > 0 ? saved : fingerCounts);
    setState("result");
  }

  // ── useEffect: FACE_DETECTED countdown ───────────────────────────────────────
  useEffect(() => {
    if (state !== "face_detected") return;
    countRef.current = 3;
    setCountdown(3);
    const tick = setInterval(() => {
      countRef.current -= 1;
      setCountdown(countRef.current);
      if (countRef.current <= 0) { clearInterval(tick); snap(); }
    }, 1000);
    return () => clearInterval(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── useEffect: auto-restart after result ─────────────────────────────────────
  useEffect(() => {
    if (state !== "result") return;
    const t = setTimeout(autoRestart, 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // ── snap frame → /api/capture ─────────────────────────────────────────────────
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
          // Emotion captured → move to gesture rating phase
          setGestureRatings([]);
          setLiveFingers([]);
          setState("gesture_scan");
        }
      } catch {
        setErrorMsg("Analysis failed. Please try again.");
        setState("error");
      }
    }, "image/jpeg", 0.92);
  }

  // ── auto-restart for next student ─────────────────────────────────────────────
  async function autoRestart() {
    setErrorMsg(""); setFaceBoxes([]); setGestureRatings([]); setLiveFingers([]);
    try {
      const form = new FormData();
      form.append("session_id", sessionId);
      const res = await fetch(`${API}/api/start`, { method: "POST", body: form });
      if (res.ok) setCaptureId((await res.json()).capture_id);
    } catch { /* non-blocking */ }
    setState("scanning");
  }

  // ── handleBegin ───────────────────────────────────────────────────────────────
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
    setErrorMsg(""); setCaptureId(null); setFaceBoxes([]); setGestureRatings([]); setLiveFingers([]);
    setState("welcome");
  }

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ── derived flags ─────────────────────────────────────────────────────────────
  const isEmotionCam = state === "scanning" || state === "face_detected";
  const isGestureCam = state === "gesture_scan";

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-primary)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      userSelect: "none", overflow: "hidden",
    }}>

      {/* ── HEADER (non-camera screens) ── */}
      {!isEmotionCam && !isGestureCam && state !== "analyzing" && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          height: "clamp(48px, 8vw, 56px)", zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 clamp(16px, 4vw, 32px)",
          background: "var(--bg-white)", borderBottom: "2px solid var(--border)",
          boxShadow: "var(--shadow-sm)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", boxShadow: "0 0 8px var(--brand)" }} className="animate-pulse-dot" />
            <span style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(10px, 2.5vw, 13px)", fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-heading)", textTransform: "uppercase" }}>
              EMOTION KIOSK
            </span>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(9px, 2vw, 11px)", color: "var(--text-muted)" }}>
            SESSION {sessionId.slice(0, 8).toUpperCase()}
          </span>
        </div>
      )}


      {/* ══ WELCOME ══════════════════════════════════════════════════════════════ */}
      {state === "welcome" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 520, padding: "0 clamp(16px, 5vw, 24px)", width: "100%" }}>
          <div style={{ fontSize: "clamp(44px, 14vw, 72px)", marginBottom: "clamp(12px, 4vw, 20px)" }}>👋</div>
          <h1 style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(20px, 7vw, 38px)",
            fontWeight: 900, color: "var(--text-heading)",
            textTransform: "uppercase", letterSpacing: "0.04em",
            lineHeight: 1.2, marginBottom: "clamp(8px, 2vw, 10px)",
          }}>
            How did the<br /><span style={{ color: "var(--brand)" }}>workshop</span> feel?
          </h1>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(14px, 4vw, 19px)", color: "var(--text-secondary)", marginBottom: "clamp(24px, 6vw, 36px)" }}>
            Look at the camera — we detect your reaction live.
          </p>
          <button
            onClick={handleBegin}
            style={{
              fontFamily: "var(--font-heading)", fontSize: "clamp(12px, 3.5vw, 15px)",
              fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              background: "var(--brand)", color: "#fff", border: "2px solid var(--brand)",
              borderRadius: "var(--radius-lg)",
              padding: "clamp(14px, 4vw, 20px) clamp(28px, 8vw, 64px)",
              cursor: "pointer", width: "100%",
              boxShadow: "var(--brand-glow)", transition: "all 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--brand-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "var(--brand)")}
          >
            TAP TO BEGIN
          </button>
        </div>
      )}


      {/* ══ CONSENT ══════════════════════════════════════════════════════════════ */}
      {state === "consent" && (
        <div className="animate-slide-up" style={{ maxWidth: 560, width: "100%", padding: "0 clamp(16px, 5vw, 24px)" }}>
          <div style={{ textAlign: "center", marginBottom: "clamp(16px, 4vw, 24px)" }}>
            <div style={{ fontSize: "clamp(32px, 10vw, 48px)", marginBottom: 10 }}>📷</div>
            <h2 style={{
              fontFamily: "var(--font-heading)", fontSize: "clamp(16px, 5vw, 26px)",
              fontWeight: 800, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              Live emotion scan
            </h2>
          </div>
          <div className="card" style={{ marginBottom: 20, padding: "clamp(16px, 4vw, 24px)" }}>
            {[
              ["✅", "Your camera is used live to detect your facial expression."],
              ["✅", "No video is recorded or stored — only the emotion label."],
              ["✅", "Capture is automatic once your face is detected."],
              ["✅", "Your response is completely anonymous."],
            ].map(([icon, text]) => (
              <div key={text as string} style={{ display: "flex", gap: 12, marginBottom: 12, fontFamily: "var(--font-body)", fontSize: "clamp(13px, 3.5vw, 16px)", fontWeight: 500, color: "var(--text-secondary)" }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={reset}            className="btn btn-secondary" style={{ flex: 1,  padding: "clamp(12px, 3vw, 16px)", fontSize: "clamp(10px, 2.5vw, 12px)" }}>SKIP</button>
            <button onClick={() => setState("scanning")} className="btn btn-primary"    style={{ flex: 3,  padding: "clamp(12px, 3vw, 16px)", fontSize: "clamp(11px, 3vw, 14px)" }}>I AGREE — START SCAN →</button>
          </div>
        </div>
      )}


      {/* ══ EMOTION CAMERA (scanning + face_detected) ══════════════════════════ */}
      {isEmotionCam && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 20 }}>

          {/* full-screen mirrored video */}
          <video
            ref={videoRef}
            muted playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
          />

          {/* face bounding-box overlay */}
          {faceBoxes.length > 0 && videoRef.current && (
            <svg
              viewBox={`0 0 ${videoRef.current.videoWidth} ${videoRef.current.videoHeight}`}
              preserveAspectRatio="xMidYMid slice"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", transform: "scaleX(-1)" }}
            >
              {faceBoxes.map((box, i) => (
                <rect
                  key={i}
                  x={box.x} y={box.y} width={box.w} height={box.h}
                  fill="none"
                  stroke={state === "face_detected" ? "#1C4D8C" : "rgba(255,255,255,0.7)"}
                  strokeWidth="4" rx="10"
                  style={{ filter: state === "face_detected" ? "drop-shadow(0 0 10px #1C4D8C)" : "none", transition: "stroke 0.2s" }}
                />
              ))}
              {state === "face_detected" && faceBoxes[0] && (
                <text
                  x={faceBoxes[0].x + faceBoxes[0].w / 2}
                  y={Math.max(30, faceBoxes[0].y - 14)}
                  textAnchor="middle" fill="#1C4D8C" fontSize="22"
                  fontFamily="Orbitron, sans-serif" fontWeight="700"
                  style={{ filter: "drop-shadow(0 0 6px rgba(28,77,140,0.8))" }}
                >
                  ✓ {faceBoxes.length > 1 ? `${faceBoxes.length} FACES` : "FACE"} DETECTED
                </text>
              )}
            </svg>
          )}

          {/* frame overlay */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={isMobile ? "/phoneview.png" : "/frame.png"} alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none", zIndex: 2 }} />

          {/* bottom instruction */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "clamp(20px, 5vw, 32px) 24px clamp(36px, 8vw, 52px)",
            background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)",
            zIndex: 3, textAlign: "center",
          }}>
            {state === "scanning" && (
              <>
                {faceBoxes.length === 0 && (
                  <>
                    <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(11px, 3vw, 14px)", fontWeight: 700, letterSpacing: "0.25em", color: "rgba(255,255,255,0.9)", textTransform: "uppercase", marginBottom: 8 }}>
                      POSITION YOUR FACE IN THE FRAME
                    </p>
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(12px, 3.5vw, 15px)", color: "rgba(255,255,255,0.45)" }}>
                      Capture is automatic once a face is detected
                    </p>
                  </>
                )}
                {faceBoxes.length > 0 && (
                  <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(11px, 3vw, 14px)", fontWeight: 700, letterSpacing: "0.25em", color: "#1C4D8C", textTransform: "uppercase" }}>
                    {faceBoxes.length > 1 ? `${faceBoxes.length} FACES` : "FACE"} DETECTED…
                  </p>
                )}
              </>
            )}
            {state === "face_detected" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                <div
                  key={countdown} className="animate-count-pop"
                  style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(64px, 18vw, 96px)", fontWeight: 900, color: "#fff", lineHeight: 1, textShadow: "0 0 40px rgba(28,77,140,0.9)" }}
                >{countdown}</div>
                <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(11px, 3vw, 14px)", fontWeight: 700, letterSpacing: "0.3em", color: "#fff", textTransform: "uppercase" }}>
                  HOLD STILL &amp; SMILE!
                </p>
              </div>
            )}
          </div>

          {/* corner guide brackets */}
          {state === "scanning" && faceBoxes.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 1 }}>
              <div style={{ position: "relative", width: "clamp(140px, 40vw, 340px)", aspectRatio: "3/4" }}>
                {[
                  { top: 0,    left: 0,  borderTop:    "3px solid rgba(28,77,140,0.7)", borderLeft:   "3px solid rgba(28,77,140,0.7)" },
                  { top: 0,    right: 0, borderTop:    "3px solid rgba(28,77,140,0.7)", borderRight:  "3px solid rgba(28,77,140,0.7)" },
                  { bottom: 0, left: 0,  borderBottom: "3px solid rgba(28,77,140,0.7)", borderLeft:   "3px solid rgba(28,77,140,0.7)" },
                  { bottom: 0, right: 0, borderBottom: "3px solid rgba(28,77,140,0.7)", borderRight:  "3px solid rgba(28,77,140,0.7)" },
                ].map((s, i) => (
                  <div key={i} style={{ position: "absolute", width: "clamp(24px, 5vw, 36px)", height: "clamp(24px, 5vw, 36px)", ...s }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}


      {/* ══ GESTURE CAMERA (gesture_scan) ════════════════════════════════════════ */}
      {isGestureCam && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 20 }}>

          <video
            ref={videoRef}
            muted playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
          />

          {/* Live finger-count cards (one per detected hand) */}
          {liveFingers.length > 0 && (
            <div style={{
              position: "absolute", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex", gap: "clamp(10px, 3vw, 24px)",
              flexWrap: "wrap", justifyContent: "center",
              zIndex: 5, pointerEvents: "none",
              maxWidth: "90vw",
            }}>
              {liveFingers.map((stars, i) => (
                <div key={i} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  background: "rgba(0,0,0,0.72)",
                  padding: "clamp(10px, 3vw, 16px) clamp(14px, 4vw, 24px)",
                  borderRadius: "clamp(10px, 3vw, 16px)",
                  border: `2px solid ${stableRef.current.frames >= 30 ? "#1C4D8C" : "rgba(255,255,255,0.25)"}`,
                  backdropFilter: "blur(8px)",
                  transition: "border-color 0.3s",
                }}>
                  <Stars n={stars} size={clampFontSize(22, 8, 40)} />
                  {liveFingers.length > 1 && (
                    <span style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(9px, 2vw, 11px)", letterSpacing: "0.2em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" }}>
                      PERSON {i + 1}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* frame overlay */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={isMobile ? "/phoneview.png" : "/frame.png"} alt=""
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none", zIndex: 2 }} />

          {/* top label */}
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "clamp(14px, 3vw, 20px) 24px", zIndex: 3, textAlign: "center", background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)" }}>
            <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(10px, 2.5vw, 13px)", fontWeight: 700, letterSpacing: "0.3em", color: "rgba(255,255,255,0.9)", textTransform: "uppercase" }}>
              ⭐ RATE THE WORKSHOP WITH YOUR FINGERS ⭐
            </p>
          </div>

          {/* bottom instruction */}
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "clamp(20px, 5vw, 32px) 24px clamp(36px, 8vw, 52px)",
            background: "linear-gradient(to top, rgba(0,0,0,0.9), transparent)",
            zIndex: 3, textAlign: "center",
          }}>
            {liveFingers.length === 0 ? (
              <>
                <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(14px, 4.5vw, 20px)", fontWeight: 900, letterSpacing: "0.12em", color: "#fff", textTransform: "uppercase", marginBottom: 10 }}>
                  SHOW YOUR FINGERS!
                </p>
                <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(11px, 3vw, 15px)", color: "rgba(255,255,255,0.5)" }}>
                  1 finger = ★ &nbsp;·&nbsp; 3 fingers = ★★★ &nbsp;·&nbsp; 5 fingers = ★★★★★
                </p>
              </>
            ) : (
              <>
                <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(13px, 4vw, 18px)", fontWeight: 700, letterSpacing: "0.1em", color: "#1C4D8C", textTransform: "uppercase", marginBottom: 6 }}>
                  {liveFingers.length} {liveFingers.length === 1 ? "PERSON" : "PEOPLE"} DETECTED — HOLD STILL…
                </p>
                <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(11px, 3vw, 14px)", color: "rgba(255,255,255,0.45)" }}>
                  Keep fingers steady — submitting in a moment
                </p>
              </>
            )}
          </div>
        </div>
      )}


      {/* ══ ANALYSING ════════════════════════════════════════════════════════════ */}
      {state === "analyzing" && (
        <div style={{ textAlign: "center", padding: "0 24px" }}>
          <div style={{ width: "clamp(48px, 12vw, 72px)", height: "clamp(48px, 12vw, 72px)", margin: "0 auto 24px", border: "4px solid var(--border)", borderTop: "4px solid var(--brand)", borderRadius: "50%" }} className="animate-spin-slow" />
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(16px, 5vw, 24px)", fontWeight: 700, color: "var(--text-heading)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>ANALYSING</h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 3.5vw, 16px)", color: "var(--text-muted)" }}>Analysing your expression…</p>
        </div>
      )}


      {/* ══ RESULT ═══════════════════════════════════════════════════════════════ */}
      {state === "result" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 460, padding: "0 clamp(16px, 5vw, 24px)", width: "100%" }}>
          <div style={{ fontSize: "clamp(48px, 14vw, 76px)", marginBottom: "clamp(12px, 4vw, 20px)" }}>🙏</div>
          <h2 style={{
            fontFamily: "var(--font-heading)", fontSize: "clamp(28px, 9vw, 44px)",
            fontWeight: 900, color: "var(--brand)", textTransform: "uppercase",
            letterSpacing: "0.06em", marginBottom: 12,
          }}>
            THANK YOU!
          </h2>

          {/* Star ratings if gesture was used */}
          {gestureRatings.length > 0 && (
            <div style={{ display: "flex", justifyContent: "center", gap: "clamp(10px, 4vw, 20px)", marginBottom: 20, flexWrap: "wrap" }}>
              {gestureRatings.map((stars, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <Stars n={stars} size={clampFontSize(18, 6, 32)} amber />
                  {gestureRatings.length > 1 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(8px, 2vw, 10px)", color: "var(--text-muted)" }}>PERSON {i + 1}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 4vw, 18px)", color: "var(--text-secondary)", marginBottom: 24 }}>
            Your feedback has been recorded.
          </p>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(8px, 2.5vw, 10px)", letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            NEXT STUDENT IN A MOMENT…
          </p>
        </div>
      )}


      {/* ══ NO FACE ══════════════════════════════════════════════════════════════ */}
      {state === "no_face" && (
        <div className="animate-slide-up" style={{ textAlign: "center", maxWidth: 460, padding: "0 clamp(16px, 5vw, 24px)", width: "100%" }}>
          <div style={{ fontSize: "clamp(48px, 14vw, 72px)", marginBottom: "clamp(12px, 4vw, 20px)" }}>😶</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(20px, 6.5vw, 34px)", fontWeight: 900, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            FACE NOT DETECTED
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 3.5vw, 17px)", color: "var(--text-secondary)", marginBottom: 24 }}>
            Please face the camera directly with good lighting and try again.
          </p>
          <p style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(8px, 2.5vw, 10px)", letterSpacing: "0.2em", color: "var(--text-muted)", textTransform: "uppercase" }}>
            RETRYING IN A MOMENT…
          </p>
        </div>
      )}


      {/* ══ ERROR ════════════════════════════════════════════════════════════════ */}
      {state === "error" && (
        <div style={{ textAlign: "center", maxWidth: 440, padding: "0 clamp(16px, 5vw, 24px)", width: "100%" }}>
          <div style={{ fontSize: "clamp(36px, 10vw, 52px)", marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(18px, 5.5vw, 26px)", fontWeight: 800, color: "var(--text-heading)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
            SOMETHING WENT WRONG
          </h2>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "clamp(13px, 3.5vw, 16px)", color: "var(--text-secondary)", marginBottom: 28 }}>{errorMsg}</p>
          <button onClick={reset} className="btn btn-primary" style={{ width: "100%", padding: "clamp(12px, 3vw, 16px)", fontSize: "clamp(11px, 3vw, 13px)" }}>
            TRY AGAIN
          </button>
        </div>
      )}

    </div>
  );
}

// ── clampFontSize helper (inline since no CSS access in TS) ───────────────────
function clampFontSize(minPx: number, vw: number, maxPx: number): number {
  if (typeof window === "undefined") return maxPx;
  return Math.min(maxPx, Math.max(minPx, (window.innerWidth * vw) / 100));
}

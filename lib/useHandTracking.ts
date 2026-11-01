"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type TrackingStatus = "off" | "loading" | "ready" | "tracking" | "no-camera" | "error";

export type HandFrame = {
  // Index fingertip, mirrored so moving your hand right moves the cursor right. 0..1.
  x: number;
  y: number;
  // Palm centre (wrist + knuckles), mirrored. Steadier than a fingertip for swipes. 0..1.
  palmX: number;
  palmY: number;
  // Video width / height, to compare horizontal and vertical movement fairly.
  aspect: number;
  landmarks: NormalizedLandmark[];
};

const PALM = [0, 5, 9, 13, 17];

const WASM_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/models/hand_landmarker.task";

/**
 * Runs MediaPipe's hand landmarker against the webcam and calls `onFrame`
 * once per processed video frame with the tracked hand (or null when no hand
 * is visible). Landmarks are drawn onto `canvasRef` for the preview window.
 * When `enabled` is false the webcam is released entirely.
 */
export function useHandTracking(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onFrame: (hand: HandFrame | null) => void,
  accent: string,
  enabled: boolean,
) {
  const [status, setStatus] = useState<TrackingStatus>("loading");
  const onFrameRef = useRef(onFrame);
  const accentRef = useRef(accent);

  useEffect(() => {
    onFrameRef.current = onFrame;
    accentRef.current = accent;
  });

  useEffect(() => {
    if (!enabled) return;
    const videoEl = videoRef.current;
    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("no-camera");
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" },
          audio: false,
        });
      } catch {
        if (!cancelled) setStatus("no-camera");
        return;
      }
      if (cancelled) {
        // Switched off while the camera was still starting: release it.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});

      try {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
        const create = (delegate: "GPU" | "CPU") =>
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: MODEL_PATH, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            // Lower than MediaPipe's defaults so it holds on to a blurry, fast-moving hand mid-swipe
            // instead of dropping it (a new hand still needs the full detection confidence).
            minHandPresenceConfidence: 0.3,
            minTrackingConfidence: 0.3,
          });
        landmarker = await create("GPU").catch(() => create("CPU"));
        if (cancelled) {
          landmarker.close();
          return;
        }
        setStatus("ready");
        loop(HandLandmarker.HAND_CONNECTIONS);
      } catch (err) {
        console.error("Hand tracking failed to start", err);
        if (!cancelled) setStatus("error");
      }
    }

    function loop(connections: { start: number; end: number }[]) {
      let lastTime = -1;
      let seen = false;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const video = videoRef.current;
        if (!video || !landmarker || video.readyState < 2 || video.currentTime === lastTime) return;
        lastTime = video.currentTime;

        const result = landmarker.detectForVideo(video, performance.now());
        const lm = result.landmarks[0];
        draw(lm, connections);

        if (!!lm !== seen) {
          seen = !!lm;
          setStatus(seen ? "tracking" : "ready");
        }
        if (!lm) {
          onFrameRef.current(null);
          return;
        }
        const tip = lm[8];
        const palmX = PALM.reduce((sum, i) => sum + lm[i].x, 0) / PALM.length;
        const palmY = PALM.reduce((sum, i) => sum + lm[i].y, 0) / PALM.length;
        onFrameRef.current({
          x: 1 - tip.x,
          y: tip.y,
          palmX: 1 - palmX,
          palmY,
          aspect: video.videoWidth / Math.max(video.videoHeight, 1),
          landmarks: lm,
        });
      };
      raf = requestAnimationFrame(tick);
    }

    function draw(lm: NormalizedLandmark[] | undefined, connections: { start: number; end: number }[]) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      if (!lm) return;
      ctx.lineWidth = 2;
      ctx.strokeStyle = accentRef.current;
      ctx.beginPath();
      for (const { start, end } of connections) {
        ctx.moveTo(lm[start].x * w, lm[start].y * h);
        ctx.lineTo(lm[end].x * w, lm[end].y * h);
      }
      ctx.stroke();
      ctx.fillStyle = "#FFFFFF";
      for (const [i, p] of lm.entries()) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, i === 8 ? 4 : 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
      draw(undefined, []);
      onFrameRef.current(null);
      setStatus("loading");
    };
  }, [videoRef, canvasRef, enabled]);

  return enabled ? status : "off";
}

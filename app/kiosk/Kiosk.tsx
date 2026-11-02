"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildHitLayers, buildShoe, NO_PULL } from "@/lib/shoe";
import { LEFT_LABELS, PARTS, PART_ORDER, PRODUCT, RIGHT_LABELS, SWIPE_REGIONS, type PartId } from "@/lib/product";
import { DEFAULT_SWIPE, SwipeDetector, type SwipeDir } from "@/lib/swipe";
import { hasSavedSwipeOptions, loadSwipeOptions, saveSwipeOptions } from "@/lib/swipeTeach";
import { useHandTracking, type HandFrame } from "@/lib/useHandTracking";
import styles from "./kiosk.module.css";
import TeachSwipes, { type TeachResult, type TeachSink } from "./TeachSwipes";

const ACCENT = "#BFD8FF";
const STAGE_W = 1280;
const STAGE_H = 720;

// Interaction tuning. Hands swipe; the mouse hovers (it can't swipe).
const DETAIL_HOLD_MS = 12000; // a swiped-open part closes after this long without another swipe
const HOVER_SETTLE_MS = 120; // hover this long before a part pulls out (stops flicker when sweeping across)
const HOVER_GRACE_MS = 250; // keep hover through brief tracking misses at part edges
const UNHOVER_MS = 400; // off the shoe this long → parts settle back and the shoe overview shows
const IDLE_MS = 9000; // no one around → attract mode
const HAND_MARGIN = 0.12; // ignore the outer edge of the camera frame
const SMOOTHING = 0.45;
const TRAIL_LEN = 10;
// The camera loses a hand that sits near the edge of its view (most often the bottom, where swipes
// arc out of frame). Held there this long → ask the visitor to move it toward the middle.
const EDGE_WARN_MS = 700;
const EDGE_TIPS = {
  low: "Raise your hand a little: the camera loses it near the bottom.",
  high: "Lower your hand a little: the camera loses it near the top.",
  side: "Move your hand toward the middle: the camera loses it near the sides.",
} as const;
type Edge = keyof typeof EDGE_TIPS;
const edgeOf = (x: number, y: number): Edge | null =>
  y > 0.78 ? "low" : y < 0.12 ? "high" : x < 0.1 || x > 0.9 ? "side" : null;
// Easing time constants (seconds): smaller = snappier.
const TAU_PULL = 0.2;
const TAU_FOCUS = 0.3;

const ARROWS: Record<SwipeDir, string> = { up: "↑", down: "↓", left: "←", right: "→" };
const KEY_DIRS: Record<string, SwipeDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

type Mode = "attract" | "engaged";
type Anim = { focus: number; pull: Record<PartId, number> };

const partAt = (x: number, y: number): PartId | null => {
  const el = document.elementFromPoint(x, y);
  const part = el?.closest("[data-part]")?.getAttribute("data-part");
  return (part as PartId) ?? null;
};

export default function Kiosk() {
  const [active, setActive] = useState<PartId | null>(null);
  const [mode, setMode] = useState<Mode>("attract");
  const [handVisible, setHandVisible] = useState(false);
  const [teaching, setTeaching] = useState(false); // 't': record how someone swipes and tune to it
  const [hasSaved, setHasSaved] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [showSelf, setShowSelf] = useState(false); // hidden self-view; tracking still runs
  const [scale, setScale] = useState(1);
  const [anim, setAnim] = useState<Anim>({ focus: 0, pull: NO_PULL });
  const [flash, setFlash] = useState<{ dir: SwipeDir; n: number } | null>(null);
  const [debug, setDebug] = useState<string | null>(null); // 'd' shows the last swipe and near-miss, for tuning
  const [showPointer, setShowPointer] = useState(false); // optional dot + trail following the hand
  const [edge, setEdge] = useState<Edge | null>(null); // the hand keeps sitting near an edge of the camera view
  const [camAspect, setCamAspect] = useState(16 / 9); // the camera's real shape, so the teach view shows the whole frame

  const videoRef = useRef<HTMLVideoElement>(null);
  const camCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGPolylineElement>(null);
  const swipes = useRef<SwipeDetector | null>(null);
  const teachSink = useRef<TeachSink | null>(null); // set while the teach screen is open
  const debugRef = useRef({ on: false, last: "no swipe yet", text: "", since: 0, frames: 0, handFrames: 0, stats: "", taught: false });

  // Mutable interaction state that changes every frame and shouldn't re-render.
  const ix = useRef({
    x: 0,
    y: 0,
    hasPos: false,
    hoverPart: null as PartId | null,
    hoverSince: 0,
    lastHit: 0,
    lastActive: 0,
    trail: [] as [number, number][],
    active: null as PartId | null,
    pinned: false, // swiped / tapped / keyed parts stay open (no hover to keep them there)
    swipedAt: 0,
    edge: null as Edge | null,
    edgeSince: 0,
    mode: "attract" as Mode,
  });

  const activate = useCallback((part: PartId | null) => {
    const s = ix.current;
    s.lastActive = performance.now();
    s.active = part;
    s.mode = "engaged";
    setMode("engaged");
    setActive(part);
  }, []);

  const hoverAt = useCallback((part: PartId | null, now: number) => {
    const s = ix.current;
    if (part) s.lastHit = now;
    else if (now - s.lastHit < HOVER_GRACE_MS) part = s.hoverPart;
    if (part !== s.hoverPart) {
      s.hoverPart = part;
      s.hoverSince = now;
    }
    cursorRef.current?.toggleAttribute("data-over", !!part);
  }, []);

  const clearHover = useCallback(() => {
    const s = ix.current;
    s.hoverPart = null;
    s.lastHit = 0;
    s.hoverSince = performance.now();
  }, []);

  // ---- Swipes: each direction opens the next piece in that region of the shoe --
  const onSwipe = useCallback(
    (dir: SwipeDir) => {
      const s = ix.current;
      const parts = SWIPE_REGIONS[dir].parts;
      const i = s.active ? parts.indexOf(s.active) : -1;
      s.pinned = true;
      s.swipedAt = performance.now();
      activate(parts[(i + 1) % parts.length]);
      setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
    },
    [activate],
  );

  // ---- Hand input -------------------------------------------------------
  const onHand = useCallback(
    (hand: HandFrame | null) => {
      const s = ix.current;
      const now = performance.now();
      const cursor = cursorRef.current;

      // 'd' readout: tracking rate and how often the hand is actually found help explain misses.
      const dbg = debugRef.current;
      if (dbg.on) {
        dbg.frames++;
        if (hand) dbg.handFrames++;
        if (now - dbg.since >= 1000) {
          dbg.stats = `${Math.round((dbg.frames * 1000) / (now - dbg.since))} FPS · HAND ${Math.round((100 * dbg.handFrames) / Math.max(dbg.frames, 1))}%`;
          dbg.since = now;
          dbg.frames = dbg.handFrames = 0;
        }
      }

      // While teaching, frames go to the teach screen instead of opening parts.
      const teach = teachSink.current;
      if (teach) teach(now, hand ? hand.palmX * hand.aspect : null, hand ? hand.palmY : null);

      if (!hand) {
        // A swipe that carried the hand out of view is judged once it's been gone a moment.
        const swipe = teach ? null : swipes.current?.lost(now);
        if (swipe) onSwipe(swipe.dir);
        if (s.hasPos) {
          s.hasPos = false;
          s.trail = [];
          trailRef.current?.setAttribute("points", "");
          cursor?.style.setProperty("opacity", "0");
          // The detector rides out a frame or two of lost tracking (fast swipes blur).
          setHandVisible(false);
        }
        return;
      }

      if (!swipes.current) {
        swipes.current = new SwipeDetector(loadSwipeOptions()); // taught settings, if any
        dbg.taught = hasSavedSwipeOptions();
      }
      const swipe = teach ? null : swipes.current.push(now, hand.palmX * hand.aspect, hand.palmY);
      if (swipe) onSwipe(swipe.dir);

      if (dbg.on) {
        if (swipe) dbg.last = `${swipe.dir.toUpperCase()} (dx ${swipe.dx.toFixed(2)}, dy ${swipe.dy.toFixed(2)})`;
        const miss = swipes.current.miss;
        const text = `${dbg.taught ? "MY SWIPES · " : ""}${dbg.stats} · LAST: ${dbg.last}${miss ? ` · MISSED: ${miss}` : ""}`;
        if (text !== dbg.text) {
          dbg.text = text;
          setDebug(text);
        }
      }

      // Hand kept near an edge of the camera view → tip to move it toward the middle.
      const e = edgeOf(hand.palmX, hand.palmY);
      if (e !== s.edge) {
        s.edge = e;
        s.edgeSince = now;
      }
      const warn = now - s.edgeSince >= EDGE_WARN_MS ? s.edge : undefined;
      if (warn !== undefined) setEdge(warn);

      // The optional on-screen dot follows the palm.
      const span = 1 - HAND_MARGIN * 2;
      const tx = Math.min(Math.max((hand.palmX - HAND_MARGIN) / span, 0), 1) * window.innerWidth;
      const ty = Math.min(Math.max((hand.palmY - HAND_MARGIN) / span, 0), 1) * window.innerHeight;

      if (!s.hasPos) {
        s.x = tx;
        s.y = ty;
        s.hasPos = true;
        clearHover(); // a hand takes over from the mouse; don't let a stale mouse hover win
        setHandVisible(true);
      }
      s.x += (tx - s.x) * (1 - SMOOTHING);
      s.y += (ty - s.y) * (1 - SMOOTHING);
      s.lastActive = now;
      if (s.mode !== "engaged") {
        s.mode = "engaged";
        setMode("engaged");
      }

      if (cursor) {
        cursor.style.opacity = "1";
        cursor.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
      s.trail.push([s.x, s.y]);
      if (s.trail.length > TRAIL_LEN) s.trail.shift();
      trailRef.current?.setAttribute("points", s.trail.map((p) => p.join(",")).join(" "));
    },
    [onSwipe, clearHover],
  );

  const status = useHandTracking(videoRef, camCanvasRef, onHand, ACCENT, cameraOn);
  const camOk = status !== "off" && status !== "no-camera" && status !== "error";

  const onTeachClose = useCallback((result: TeachResult) => {
    if (result) {
      const options = result === "reset" ? null : result;
      saveSwipeOptions(options); // kept on this machine
      swipes.current = new SwipeDetector(options ?? DEFAULT_SWIPE);
      debugRef.current.taught = !!options;
    }
    setTeaching(false);
  }, []);

  // ---- Mouse / touch (staff testing, touchscreens, camera off) -------------
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = ix.current;
      if (s.hasPos) return; // a tracked hand takes priority
      s.lastActive = performance.now();
      if (s.mode !== "engaged") {
        s.mode = "engaged";
        setMode("engaged");
      }
      hoverAt(partAt(e.clientX, e.clientY), performance.now());
    };
    const down = (e: PointerEvent) => {
      if ((e.target as Element).closest("button")) return;
      const part = partAt(e.clientX, e.clientY);
      ix.current.pinned = e.pointerType === "touch" && !!part;
      activate(part);
    };
    const key = (e: KeyboardEvent) => {
      if (KEY_DIRS[e.key] && !teachSink.current) onSwipe(KEY_DIRS[e.key]); // arrow keys act like swipes, for testing
      if (e.key === "t") {
        setHasSaved(hasSavedSwipeOptions());
        setTeaching((v) => !v);
      }
      if (e.key === "Escape") setTeaching(false);
      if (e.key === "d") {
        const dbg = debugRef.current;
        dbg.on = !dbg.on;
        dbg.text = "";
        setDebug(dbg.on ? `LAST: ${dbg.last}` : null);
      }
      if (e.key === "p") setShowPointer((v) => !v);
      if (e.key === "c") setShowSelf((v) => !v);
      if (e.key === "o") setCameraOn((v) => !v);
      if (e.key === "f") {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    const leave = () => clearHover();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [activate, hoverAt, clearHover, onSwipe]);

  // ---- Animation loop: settle hover, ease pull / focus ----------------------
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const cur: Anim = { focus: 0, pull: { ...NO_PULL } };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = ix.current;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (s.hoverPart && s.hoverPart !== s.active && now - s.hoverSince >= HOVER_SETTLE_MS) {
        s.pinned = false;
        activate(s.hoverPart);
      } else if (!s.hoverPart && s.active && s.mode === "engaged" && !s.pinned && now - s.hoverSince >= UNHOVER_MS) {
        activate(null);
      } else if (s.swipedAt && s.active && now - s.swipedAt > DETAIL_HOLD_MS) {
        // No swipe for a while: back to the whole shoe.
        s.swipedAt = 0;
        s.pinned = false;
        activate(null);
      }
      // Nobody around: back to the whole, gently swaying shoe.
      if (s.mode === "engaged" && !s.hasPos && now - s.lastActive > IDLE_MS) {
        s.mode = "attract";
        s.active = null;
        s.pinned = false;
        s.swipedAt = 0;
        setMode("attract");
        setActive(null);
      }

      const ease = (from: number, to: number, tau: number) => {
        const v = from + (to - from) * (1 - Math.exp(-dt / tau));
        return Math.abs(to - v) < 0.002 ? to : v;
      };
      let changed = false;
      const step = (from: number, to: number, tau: number) => {
        const v = ease(from, to, tau);
        if (v !== from) changed = true;
        return v;
      };
      cur.focus = step(cur.focus, s.active ? 1 : 0, TAU_FOCUS);
      for (const id of PART_ORDER) cur.pull[id] = step(cur.pull[id], id === s.active ? 1 : 0, TAU_PULL);
      if (changed) setAnim({ focus: cur.focus, pull: { ...cur.pull } });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activate]);

  // ---- Fit the 1280×720 artboard to any screen -----------------------------
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const shoeOpts = useMemo(() => ({ w: 700, accent: ACCENT, ...anim }), [anim]);
  const slices = useMemo(() => buildShoe(shoeOpts), [shoeOpts]);
  const hitLayers = useMemo(() => buildHitLayers(shoeOpts), [shoeOpts]);

  const info = active ? PARTS[active] : PRODUCT.overview;
  const engaged = mode === "engaged";
  const motion = active ? "paused" : "running";
  const headline = !engaged
    ? camOk
      ? "RAISE A HAND TO EXPLORE"
      : "TOUCH TO EXPLORE"
    : !camOk
      ? "HOVER OVER A PART"
      : handVisible
        ? "SWIPE TO EXPLORE"
        : "RAISE A HAND, THEN SWIPE";
  const tip = camOk && handVisible && edge ? EDGE_TIPS[edge] : null;
  const subline = !engaged
    ? "Every part of this shoe has a story. Take a look inside."
    : tip
      ? tip
      : camOk
        ? "Up for the top, down for the sole, left for the heel, right for the toe."
        : "Move over any part, or tap its name.";

  const label = (id: PartId) => {
    const on = id === active;
    return (
      <span key={id} data-part={id} className={styles.label} style={{ color: on ? "#FFFFFF" : undefined, fontWeight: on ? 700 : 500 }}>
        <span className={styles.dot} style={{ background: ACCENT, boxShadow: `0 0 10px ${ACCENT}`, opacity: on ? 1 : 0 }} />
        {PARTS[id].label}
      </span>
    );
  };

  return (
    <div className={styles.viewport}>
      <div className={styles.stage} style={{ transform: `scale(${scale})` }}>
        <div aria-hidden="true" className={styles.frame} />
        <div className={styles.eyebrow}>
          {PRODUCT.name} / {PRODUCT.tagline}
        </div>

        <div className={styles.headline}>
          <span key={headline} className={styles.headlineTitle}>
            {headline}
          </span>
          <span className={styles.headlineSub} style={tip ? { color: ACCENT } : undefined}>
            {subline}
          </span>
        </div>

        {/* The whole shoe sways and floats while no part is open; it holds still while one is,
            so the open piece doesn't drift out from under the cursor. */}
        <div className={styles.shadow} style={{ animationPlayState: motion }} />
        <div className={styles.shoeWrap} style={{ animationPlayState: motion }}>
          <div className={styles.shoe} style={{ animationPlayState: motion }}>
            {slices.map((sl, i) => (
              <svg
                key={i}
                viewBox="0 -110 620 480"
                width="700"
                height="542"
                aria-hidden="true"
                className={styles.slice}
                style={{ transform: `translateZ(${sl.z}px)` }}
              >
                {sl.parts.map((pt) => (
                  <path
                    key={pt.key}
                    d={pt.d}
                    transform={pt.tf}
                    fill={pt.fill}
                    stroke={pt.stroke}
                    strokeWidth={pt.sw}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={pt.op}
                  />
                ))}
              </svg>
            ))}
            {hitLayers.map((layer) => (
              <svg
                key={layer.key}
                viewBox="0 -110 620 480"
                width="700"
                height="542"
                aria-hidden="true"
                className={styles.slice}
                style={{ transform: `translateZ(${layer.z}px)` }}
              >
                {layer.paths.map((hp) => (
                  <path
                    key={hp.key}
                    data-part={layer.part}
                    d={hp.d}
                    transform={hp.tf}
                    fill="transparent"
                    stroke="transparent"
                    strokeWidth={hp.lace ? 18 : 6}
                    strokeLinecap="round"
                    className={styles.hit}
                  />
                ))}
              </svg>
            ))}
          </div>
        </div>

        {/* Swipe hints sit on the side of the shoe each swipe opens. */}
        {camOk &&
          (Object.keys(SWIPE_REGIONS) as SwipeDir[]).map((dir) => (
            <div
              key={flash?.dir === dir ? `${dir}-${flash.n}` : dir}
              className={styles.swipeHint}
              data-dir={dir}
              data-flash={flash?.dir === dir ? "" : undefined}
              data-on={active && SWIPE_REGIONS[dir].parts.includes(active) ? "" : undefined}
            >
              {dir === "right" ? `${SWIPE_REGIONS[dir].label} ${ARROWS[dir]}` : `${ARROWS[dir]} ${SWIPE_REGIONS[dir].label}`}
            </div>
          ))}

        <div className={styles.labelsLeft}>{LEFT_LABELS.map(label)}</div>
        <div className={styles.labelsRight}>{RIGHT_LABELS.map(label)}</div>

        <div key={active ?? "overview"} className={styles.info}>
          <span className={styles.infoTitle}>{info.label}</span>
          <span className={styles.infoBlurb}>{info.blurb}</span>
          <span className={styles.infoSpecs}>{info.specs}</span>
        </div>

        {/* Small self-view in the corner; while teaching, a large one beside the prompts so you can
            see your hand stay inside the area the camera tracks reliably. */}
        <div
          className={teaching && camOk ? `${styles.cam} ${styles.camTeach}` : styles.cam}
          style={{ opacity: camOk && (showSelf || teaching) ? 1 : 0, ...(teaching ? { height: 456 / camAspect } : null) }}
        >
          <video
            ref={videoRef}
            className={styles.camVideo}
            muted
            playsInline
            onLoadedMetadata={(e) => setCamAspect(e.currentTarget.videoWidth / Math.max(e.currentTarget.videoHeight, 1))}
          />
          <canvas ref={camCanvasRef} width={320} height={180} className={styles.camVideo} />
          {teaching && (
            <>
              <div className={styles.camGuide} />
              <div className={styles.camGuideLabel}>KEEP YOUR HAND INSIDE THE BOX</div>
            </>
          )}
        </div>

        <div className={styles.hint}>
          <span
            className={styles.statusDot}
            data-status={status}
            title={STATUS_TEXT[status]}
            style={status === "tracking" ? { background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` } : undefined}
          />
          {debug ?? (camOk ? "SWIPE ↑ ↓ ← →" : STATUS_TEXT[status])}
          {camOk && (
            <button
              type="button"
              className={styles.camToggle}
              aria-pressed={showSelf}
              onClick={() => setShowSelf((v) => !v)}
            >
              {showSelf ? "HIDE CAMERA VIEW" : "SHOW CAMERA VIEW"}
            </button>
          )}
          <button
            type="button"
            className={styles.camToggle}
            aria-pressed={showPointer}
            onClick={() => setShowPointer((v) => !v)}
          >
            {showPointer ? "HIDE HAND DOT" : "SHOW HAND DOT"}
          </button>
          <button
            type="button"
            className={styles.camToggle}
            aria-pressed={!cameraOn}
            data-off={cameraOn ? undefined : ""}
            onClick={() => setCameraOn((v) => !v)}
          >
            {cameraOn ? "TURN CAMERA OFF" : "TURN CAMERA ON"}
          </button>
        </div>

        {teaching && camOk && (
          <TeachSwipes sinkRef={teachSink} handVisible={handVisible} hasSaved={hasSaved} onClose={onTeachClose} />
        )}
      </div>

      {/* Optional hand pointer (off by default: the kiosk just responds to swipes).
          It lives outside the scaled stage so it maps 1:1 to the screen. */}
      {showPointer && (
        <>
          <svg className={styles.trail} aria-hidden="true">
            <polyline ref={trailRef} fill="none" stroke={ACCENT} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div ref={cursorRef} className={styles.cursor} aria-hidden="true">
            <svg width="64" height="64" viewBox="-32 -32 64 64">
              <circle r="9" fill={ACCENT} />
              <circle r="22" fill="none" stroke={ACCENT} strokeWidth="3" className={styles.cursorRing} />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_TEXT = {
  off: "CAMERA OFF · TOUCH OR CLICK TO EXPLORE",
  loading: "STARTING CAMERA…",
  ready: "CAMERA READY",
  tracking: "HAND DETECTED",
  "no-camera": "NO CAMERA · TOUCH OR CLICK TO EXPLORE",
  error: "TRACKING UNAVAILABLE · TOUCH OR CLICK TO EXPLORE",
} as const;

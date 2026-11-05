"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOPICS, type PartId } from "@/lib/product";
import { newSession, saveLead, type LeadMethod, type Session } from "@/lib/session";
import { DEFAULT_SWIPE, SwipeDetector, type SwipeDir } from "@/lib/swipe";
import { hasSavedSwipeOptions, loadSwipeOptions, saveSwipeOptions } from "@/lib/swipeTeach";
import { useHandTracking, type HandFrame } from "@/lib/useHandTracking";
import styles from "./kiosk.module.css";
import { Hub, Lead, Staff } from "./Screens";
import TeachSwipes, { type TeachResult, type TeachSink } from "./TeachSwipes";

const ACCENT = "#BFD8FF";
const STAGE_W = 1280;
const STAGE_H = 720;

type Screen = "hub" | "staff" | "lead";
const DEFAULT_TOPIC = 1; // "How it works": the exploded earbud is the strongest first impression

// Timing.
const PRESENT_MS = 8000; // no hand and no touch/mouse for this long → nobody is at the kiosk
const ATTRACT_CYCLE_MS = 5000; // nobody here: flip through the topics like a pamphlet on a stand
const RESET_MS = 45000; // nobody here this long → clear the visitor's session, back to the start
const RESET_STAFF_MS = 180000; // they were told to look around while staff come over, so wait longer
const HAND_GRACE_MS = 250; // keep a dwell going through brief tracking misses
const HAND_MARGIN = 0.12; // ignore the outer edge of the camera frame
const SMOOTHING = 0.45;
const TRAIL_LEN = 10;
const TAU_EXPLODE = 0.35; // easing time constant (s) for the earbud coming apart

// The camera loses a hand near the edge of its view. Held there this long → ask the visitor to move it.
const EDGE_WARN_MS = 700;
const EDGE_TIPS = {
  low: "Raise your hand a little: the camera loses it near the bottom.",
  high: "Lower your hand a little: the camera loses it near the top.",
  side: "Move your hand toward the middle: the camera loses it near the sides.",
} as const;
type Edge = keyof typeof EDGE_TIPS;
const edgeOf = (x: number, y: number): Edge | null =>
  y > 0.78 ? "low" : y < 0.12 ? "high" : x < 0.1 || x > 0.9 ? "side" : null;

const KEY_DIRS: Record<string, SwipeDir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

export default function Kiosk() {
  const [screen, setScreen] = useState<Screen>("hub");
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [present, setPresent] = useState(false); // someone is using the kiosk (else attract loop)
  const [hoverPart, setHoverPart] = useState<PartId | null>(null); // a "how it works" row under the pointer
  const [explode, setExplode] = useState(TOPICS[DEFAULT_TOPIC].explode);
  // The session lives in a ref (time per topic grows every frame); screens get a snapshot of it.
  const [view, setView] = useState<Session>(newSession);
  const [handVisible, setHandVisible] = useState(false);
  const [swipeMode, setSwipeMode] = useState(false); // top-right switch: hands swipe instead of pointing
  const [teaching, setTeaching] = useState(false); // 't' (swipe mode): record how someone swipes and tune to it
  const [hasSaved, setHasSaved] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [showSelf, setShowSelf] = useState(false); // hidden self-view; tracking still runs
  const [scale, setScale] = useState(1);
  const [debug, setDebug] = useState<string | null>(null); // 'd': tracking rate and last swipe
  const [edge, setEdge] = useState<Edge | null>(null);
  const [camAspect, setCamAspect] = useState(16 / 9);

  const videoRef = useRef<HTMLVideoElement>(null);
  const camCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGPolylineElement>(null);
  const swipes = useRef<SwipeDetector | null>(null);
  const teachSink = useRef<TeachSink | null>(null);
  const swipeModeRef = useRef(false);
  const debugRef = useRef({ on: false, last: "no swipe yet", text: "", since: 0, frames: 0, handFrames: 0, stats: "" });
  const session = useRef<Session>(newSession());

  // Mutable per-frame state that shouldn't re-render.
  const ix = useRef({
    screen: "hub" as Screen,
    topic: DEFAULT_TOPIC,
    present: false,
    lastActive: 0, // last time a hand, touch or mouse was seen
    lastCycle: 0,
    hasPos: false,
    x: 0,
    y: 0,
    trail: [] as [number, number][],
    dwellEl: null as HTMLElement | null,
    dwellSince: 0,
    dwellHit: 0,
    dwellFired: false,
    hoverPart: null as PartId | null,
    edge: null as Edge | null,
    edgeSince: 0,
  });

  const bump = useCallback(() => setView({ ...session.current, time: { ...session.current.time }, picked: [...session.current.picked] }), []);

  // ---- Session -------------------------------------------------------------
  const markPresent = useCallback((now: number) => {
    const s = ix.current;
    s.lastActive = now;
    if (!s.present) {
      s.present = true;
      setPresent(true);
      if (!session.current.start) session.current.start = Date.now();
    }
  }, []);

  const pickTopic = useCallback(
    (i: number, byVisitor = true) => {
      const n = TOPICS.length;
      i = ((i % n) + n) % n;
      ix.current.topic = i;
      setTopic(i);
      setHoverPart(null);
      ix.current.hoverPart = null;
      if (byVisitor) {
        const picked = session.current.picked;
        if (!picked.includes(TOPICS[i].id)) picked.push(TOPICS[i].id);
        bump();
      }
    },
    [bump],
  );

  const go = useCallback(
    (to: Screen) => {
      ix.current.screen = to;
      if (to === "staff" && !session.current.staffAsked) session.current.staffAsked = Date.now();
      clearDwell(ix.current);
      setHoverPart(null);
      setScreen(to);
      bump();
    },
    [bump],
  );

  const resetVisitor = useCallback(() => {
    session.current = newSession();
    ix.current.screen = "hub";
    setScreen("hub");
    pickTopic(DEFAULT_TOPIC, false);
    bump();
  }, [pickTopic, bump]);

  const updateSession = useCallback(
    (patch: Partial<Session>) => {
      Object.assign(session.current, patch);
      bump();
    },
    [bump],
  );

  const onSent = useCallback(
    (method: LeadMethod) => {
      session.current.sent = method;
      saveLead(session.current, method);
      bump();
    },
    [bump],
  );

  // ---- Swipes: flip through topics like pages; on other screens, swipe right to go back ----
  const onSwipe = useCallback(
    (dir: SwipeDir) => {
      markPresent(performance.now());
      if (ix.current.screen !== "hub") {
        if (dir === "right") go("hub");
        return;
      }
      pickTopic(ix.current.topic + (dir === "left" || dir === "down" ? 1 : -1));
    },
    [go, pickTopic, markPresent],
  );

  // ---- Pointing: whatever the hand (or mouse) is over ------------------------
  // Hands press things by holding still over them (dwell); the mouse only dwells on topics and clicks the rest.
  const pointAt = useCallback((x: number, y: number, source: "hand" | "mouse", now: number) => {
    const s = ix.current;
    const hit = document.elementFromPoint(x, y);
    let target = (hit?.closest("[data-dwell]") as HTMLElement | null) ?? null;
    if (target && (target.hasAttribute("data-current") || (source === "mouse" && !target.hasAttribute("data-dwell-mouse")))) target = null;
    if (target) s.dwellHit = now;
    else if (source === "hand" && s.dwellEl && now - s.dwellHit < HAND_GRACE_MS) target = s.dwellEl;
    if (target !== s.dwellEl) {
      clearDwell(s);
      if (target) {
        s.dwellEl = target;
        s.dwellSince = now;
        const ms = Number(target.dataset.dwell) || 1000;
        target.style.setProperty("--dwell", `${ms}ms`);
        target.setAttribute("data-dwelling", "");
        cursorRef.current?.style.setProperty("--dwell", `${ms}ms`);
      }
    }
    const cursor = cursorRef.current;
    cursor?.toggleAttribute("data-over", !!target);
    cursor?.toggleAttribute("data-dwelling", !!target && !s.dwellFired);

    const part = (hit?.closest("[data-part]")?.getAttribute("data-part") as PartId | null) ?? null;
    if (part !== s.hoverPart) {
      s.hoverPart = part;
      setHoverPart(part);
    }
  }, []);

  const pointerGone = useCallback(() => {
    const s = ix.current;
    clearDwell(s);
    cursorRef.current?.removeAttribute("data-over");
    cursorRef.current?.removeAttribute("data-dwelling");
    if (s.hoverPart) {
      s.hoverPart = null;
      setHoverPart(null);
    }
  }, []);

  // ---- Hand input -------------------------------------------------------
  const onHand = useCallback(
    (hand: HandFrame | null) => {
      const s = ix.current;
      const now = performance.now();
      const cursor = cursorRef.current;

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

      // While teaching, frames go to the teach screen instead.
      const teach = teachSink.current;
      if (teach) teach(now, hand ? hand.palmX * hand.aspect : null, hand ? hand.palmY : null);
      const swiping = swipeModeRef.current;

      if (!hand) {
        const swipe = teach || !swiping ? null : swipes.current?.lost(now);
        if (swipe) onSwipe(swipe.dir);
        if (s.hasPos) {
          s.hasPos = false;
          s.trail = [];
          trailRef.current?.setAttribute("points", "");
          cursor?.style.setProperty("opacity", "0");
          pointerGone();
          setHandVisible(false);
        }
        return;
      }

      if (!swipes.current) swipes.current = new SwipeDetector(loadSwipeOptions());
      const swipe = teach || !swiping ? null : swipes.current.push(now, hand.palmX * hand.aspect, hand.palmY);
      if (swipe) onSwipe(swipe.dir);

      if (dbg.on) {
        if (swipe) dbg.last = `${swipe.dir.toUpperCase()} (dx ${swipe.dx.toFixed(2)}, dy ${swipe.dy.toFixed(2)})`;
        const miss = swipes.current.miss;
        const text = swiping ? `${dbg.stats} · LAST: ${dbg.last}${miss ? ` · MISSED: ${miss}` : ""}` : `POINT · ${dbg.stats}`;
        if (text !== dbg.text) {
          dbg.text = text;
          setDebug(text);
        }
      }

      const e = edgeOf(hand.palmX, hand.palmY);
      if (e !== s.edge) {
        s.edge = e;
        s.edgeSince = now;
      }
      if (now - s.edgeSince >= EDGE_WARN_MS) setEdge(s.edge);

      // The on-screen pointer follows the index fingertip.
      const span = 1 - HAND_MARGIN * 2;
      const tx = Math.min(Math.max((hand.x - HAND_MARGIN) / span, 0), 1) * window.innerWidth;
      const ty = Math.min(Math.max((hand.y - HAND_MARGIN) / span, 0), 1) * window.innerHeight;
      if (!s.hasPos) {
        s.x = tx;
        s.y = ty;
        s.hasPos = true;
        pointerGone(); // a hand takes over from the mouse
        setHandVisible(true);
      }
      s.x += (tx - s.x) * (1 - SMOOTHING);
      s.y += (ty - s.y) * (1 - SMOOTHING);
      markPresent(now);

      if (swiping || teach) return;
      if (cursor) {
        cursor.style.opacity = "1";
        cursor.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
      s.trail.push([s.x, s.y]);
      if (s.trail.length > TRAIL_LEN) s.trail.shift();
      trailRef.current?.setAttribute("points", s.trail.map((p) => p.join(",")).join(" "));
      pointAt(s.x, s.y, "hand", now);
    },
    [onSwipe, pointAt, pointerGone, markPresent],
  );

  const status = useHandTracking(videoRef, camCanvasRef, onHand, ACCENT, cameraOn);
  const camOk = status !== "off" && status !== "no-camera" && status !== "error";

  const toggleSwipeMode = useCallback(() => {
    const on = !swipeModeRef.current;
    swipeModeRef.current = on;
    pointerGone();
    cursorRef.current?.style.setProperty("opacity", "0");
    if (!on) setTeaching(false);
    setSwipeMode(on);
  }, [pointerGone]);

  const onTeachClose = useCallback((result: TeachResult) => {
    if (result) {
      const options = result === "reset" ? null : result;
      saveSwipeOptions(options);
      swipes.current = new SwipeDetector(options ?? DEFAULT_SWIPE);
    }
    setTeaching(false);
  }, []);

  // ---- Mouse / touch / keys -------------------------------------------------
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const now = performance.now();
      markPresent(now);
      if (ix.current.hasPos || e.pointerType === "touch") return; // a tracked hand takes priority
      pointAt(e.clientX, e.clientY, "mouse", now);
    };
    const down = () => markPresent(performance.now());
    const key = (e: KeyboardEvent) => {
      if ((e.target as Element).closest("input, textarea")) return; // typing an email
      markPresent(performance.now());
      if (KEY_DIRS[e.key] && !teachSink.current) onSwipe(KEY_DIRS[e.key]); // arrow keys act like swipes
      if (e.key === "t" && swipeModeRef.current) {
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
      if (e.key === "c") setShowSelf((v) => !v);
      if (e.key === "o") setCameraOn((v) => !v);
      if (e.key === "r") resetVisitor(); // staff: start fresh for the next visitor
      if (e.key === "f") {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    document.documentElement.addEventListener("pointerleave", pointerGone);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
      document.documentElement.removeEventListener("pointerleave", pointerGone);
    };
  }, [pointAt, pointerGone, onSwipe, markPresent, resetVisitor]);

  // ---- Frame loop: dwell, time per topic, attract loop, reset, explode easing ----
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let cur = TOPICS[ix.current.topic].explode;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = ix.current;
      const dt = Math.min(now - last, 100);
      last = now;

      // Held long enough over something: press it.
      if (s.dwellEl && !s.dwellFired && now - s.dwellSince >= (Number(s.dwellEl.dataset.dwell) || 1000)) {
        s.dwellFired = true;
        s.dwellEl.removeAttribute("data-dwelling");
        cursorRef.current?.removeAttribute("data-dwelling");
        s.dwellEl.click();
      }

      const idle = now - s.lastActive;
      if (s.present) {
        if (s.screen === "hub") {
          const id = TOPICS[s.topic].id;
          session.current.time[id] = (session.current.time[id] ?? 0) + dt;
        }
        if (idle > PRESENT_MS) {
          s.present = false;
          s.lastCycle = now;
          setPresent(false);
        }
      } else if (s.screen === "hub" && session.current.start === 0 && now - s.lastCycle > ATTRACT_CYCLE_MS) {
        // Nobody here (and no unfinished visit): flip to the next topic to draw people in.
        s.lastCycle = now;
        pickTopic(s.topic + 1, false);
      }
      if (session.current.start && !s.present && idle > (s.screen === "staff" ? RESET_STAFF_MS : RESET_MS)) {
        s.lastCycle = now;
        resetVisitor();
      }

      const target = TOPICS[s.topic].explode;
      if (cur !== target) {
        cur += (target - cur) * (1 - Math.exp(-dt / 1000 / TAU_EXPLODE));
        if (Math.abs(target - cur) < 0.003) cur = target;
        setExplode(Math.round(cur * 1000) / 1000);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pickTopic, resetVisitor]);

  // ---- Fit the 1280×720 artboard to any screen -----------------------------
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const tip = camOk && handVisible && edge ? EDGE_TIPS[edge] : null;
  const guide = !present
    ? {
        title: camOk ? "RAISE A HAND TO START" : "TOUCH A TOPIC TO START",
        sub: "Pick what you want to know, in any order",
      }
    : !camOk
      ? { title: "TOUCH OR HOVER OVER A TOPIC", sub: "Pick in any order" }
      : swipeMode
        ? { title: handVisible ? "SWIPE LEFT FOR THE NEXT TOPIC" : "RAISE A HAND, THEN SWIPE", sub: "Swipe right to go back a topic" }
        : { title: "HOLD YOUR HAND OVER A TOPIC", sub: "It opens after a second · pick in any order" };

  const s = view;
  return (
    <div className={styles.viewport}>
      <div className={styles.stage} style={{ transform: `scale(${scale})` }}>
        <div aria-hidden="true" className={styles.frame} />

        {screen === "hub" && (
          <Hub
            topic={topic}
            onPick={(i) => pickTopic(i)}
            hoverPart={hoverPart}
            explode={explode}
            accent={ACCENT}
            guide={{ ...guide, sub: tip ?? guide.sub, tip: !!tip }}
            attract={!present}
            onTeam={() => go("staff")}
            onBrochure={() => go("lead")}
          />
        )}
        {screen === "staff" && (
          <Staff
            session={s}
            onBack={() => go("hub")}
            onLead={() => go("lead")}
            onAccept={() => updateSession({ staffAccepted: true })}
            onPass={() => updateSession({ staff: s.staff + 1, staffAccepted: false })}
          />
        )}
        {screen === "lead" && (
          <Lead session={s} onChange={updateSession} onSent={onSent} onBack={() => go("hub")} onTeam={() => go("staff")} />
        )}

        {/* Kiosk controls (top-right, above the "Talk to our team" link). */}
        <div className={styles.controls}>
          <span
            className={styles.statusDot}
            data-status={status}
            title={STATUS_TEXT[status]}
            style={status === "tracking" ? { background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` } : undefined}
          />
          <span className={styles.statusText}>{debug ?? (camOk ? (swipeMode ? "SWIPE ← →" : "POINT & HOLD") : STATUS_TEXT[status])}</span>
          {camOk && (
            <button
              type="button"
              className={styles.modeToggle}
              role="switch"
              aria-checked={swipeMode}
              onClick={toggleSwipeMode}
              title="Off: hold your hand over a topic to open it. On: swipe to flip through topics."
            >
              SWIPE
              <span className={styles.switchTrack}>
                <span className={styles.switchKnob} />
              </span>
            </button>
          )}
          {camOk && (
            <button type="button" className={styles.camToggle} aria-pressed={showSelf} onClick={() => setShowSelf((v) => !v)}>
              {showSelf ? "HIDE CAMERA VIEW" : "CAMERA VIEW"}
            </button>
          )}
          <button
            type="button"
            className={styles.camToggle}
            aria-pressed={!cameraOn}
            data-off={cameraOn ? undefined : ""}
            onClick={() => setCameraOn((v) => !v)}
          >
            {cameraOn ? "CAMERA OFF" : "CAMERA ON"}
          </button>
        </div>

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

        {teaching && camOk && (
          <TeachSwipes sinkRef={teachSink} handVisible={handVisible} hasSaved={hasSaved} onClose={onTeachClose} />
        )}
      </div>

      {/* Hand pointer (pointing mode). Outside the scaled stage so it maps 1:1 to the screen.
          Its ring fills while the hand holds over something that can be pressed. */}
      {!swipeMode && camOk && (
        <>
          <svg className={styles.trail} aria-hidden="true">
            <polyline ref={trailRef} fill="none" stroke={ACCENT} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div ref={cursorRef} className={styles.cursor} aria-hidden="true">
            <svg width="64" height="64" viewBox="-32 -32 64 64">
              <circle r="9" fill={ACCENT} />
              <circle r="22" fill="none" stroke={ACCENT} strokeWidth="3" className={styles.cursorRing} />
              <circle r="22" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeDasharray="138.3" className={styles.cursorDwell} />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}

function clearDwell(s: { dwellEl: HTMLElement | null; dwellFired: boolean }) {
  s.dwellEl?.removeAttribute("data-dwelling");
  s.dwellEl = null;
  s.dwellFired = false;
}

const STATUS_TEXT = {
  off: "CAMERA OFF · TOUCH OR CLICK",
  loading: "STARTING CAMERA…",
  ready: "CAMERA READY",
  tracking: "HAND DETECTED",
  "no-camera": "NO CAMERA · TOUCH OR CLICK",
  error: "TRACKING UNAVAILABLE · TOUCH OR CLICK",
} as const;

// "Teach swipes": record how someone actually swipes, derive detector settings
// from it, and check those settings by replaying the recording.

import { DEFAULT_SWIPE, OPPOSITE, SwipeDetector, type Swipe, type SwipeDir, type SwipeOptions } from "./swipe";

/** One tracking frame: time (ms) and palm position in frame heights, or null when no hand. */
export type Frame = [number, number, number] | [number, null, null];
export type Recording = { dir: SwipeDir; frames: Frame[] };

export const TEACH_REPEATS = 5;
export const TEACH_PLAN: SwipeDir[] = (["up", "down", "left", "right"] as SwipeDir[]).flatMap((d) =>
  Array<SwipeDir>(TEACH_REPEATS).fill(d),
);

/** Very permissive settings, used only to find where each recorded swipe starts and ends. */
export const LOOSE: SwipeOptions = {
  ...DEFAULT_SWIPE,
  startSpeed: 0.35,
  endSpeed: 0.2,
  distance: 0.1,
  minPeakSpeed: 0.4,
  dominance: 1,
  cooldownMs: 0,
  returnMs: 0,
  returnNearMs: 0,
  warmupMs: 0,
};

const HISTORY_MS = 4000; // keep this much before a swipe, so the whole movement is recorded
const AFTER_MS = 900; // record at least this long after a swipe...
const SETTLE_MS = 400; // ...and until the hand has been still this long (it came back and rested)
const MAX_AFTER_MS = 3500; // ...but no longer than this
const STILL_SPEED = 0.25; // frame heights / s...
const STILL_SPAN_MS = 150; // ...measured over this long, so tracking jitter doesn't count as moving

/**
 * Splits a live stream of frames into one recording per prompt. Each recording holds the
 * swipe plus the hand coming back to rest, so the next prompt starts from a still hand.
 */
export class TeachRecorder {
  step = 0;
  private frames: Frame[] = [];
  private det = new SwipeDetector(LOOSE);
  private doneAt = 0;
  private movedAt = 0;

  /** Returns "got" when the prompted swipe was seen, or the finished recording once the hand settled. */
  push(t: number, x: number | null, y: number | null): { got: SwipeDir } | { done: Recording } | null {
    if (this.step >= TEACH_PLAN.length) return null;
    this.frames.push(x === null ? [t, null, null] : [t, x, y!]);
    // Compare with where the hand was ~150 ms ago.
    let i = this.frames.length - 2;
    while (i > 0 && t - this.frames[i][0] < STILL_SPAN_MS) i--;
    const p = this.frames[Math.max(i, 0)];
    const moving = x === null || p[1] === null || t - p[0] < STILL_SPAN_MS / 2 || Math.hypot(x - p[1], y! - p[2]!) / ((t - p[0]) / 1000) > STILL_SPEED;
    if (moving) this.movedAt = t;

    if (!this.doneAt) {
      while (this.frames.length > 1 && t - this.frames[0][0] > HISTORY_MS) this.frames.shift();
      const s = x === null ? this.det.lost(t) : this.det.push(t, x, y!);
      // Moving the opposite way is the hand coming back from the last swipe, not this one.
      if (s && s.dir !== OPPOSITE[TEACH_PLAN[this.step]] && Math.max(Math.abs(s.dx), Math.abs(s.dy)) >= 0.08) {
        this.doneAt = t;
        return { got: s.dir };
      }
      return null;
    }
    const since = t - this.doneAt;
    if ((since > AFTER_MS && t - this.movedAt > SETTLE_MS) || since > MAX_AFTER_MS) {
      const done: Recording = { dir: TEACH_PLAN[this.step], frames: this.frames };
      this.step++;
      this.frames = [];
      this.det = new SwipeDetector(LOOSE);
      this.doneAt = 0;
      return { done };
    }
    return null;
  }
}

/** Feed recorded frames through a detector; returns every swipe it reports. */
export function replay(frames: Frame[], options: SwipeOptions): Swipe[] {
  const d = new SwipeDetector(options);
  const out: Swipe[] = [];
  for (const [t, x, y] of frames) {
    const s = x === null ? d.lost(t) : d.push(t, x, y!);
    if (s) out.push(s);
  }
  const end = frames.length ? frames[frames.length - 1][0] : 0;
  const s = d.lost(end + 1000); // flush a stroke still in progress
  if (s) out.push(s);
  return out;
}

const AXIS: Record<SwipeDir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const along = (s: Swipe, dir: SwipeDir) => s.dx * AXIS[dir][0] + s.dy * AXIS[dir][1];

/** The swipe the person made in a recording: the movement that went furthest the way they were asked. */
export function strokeOf(rec: Recording): Swipe | null {
  const strokes = replay(rec.frames, LOOSE);
  return strokes.reduce<Swipe | null>((best, s) => (!best || along(s, rec.dir) > along(best, rec.dir) ? s : best), null);
}
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const low = (xs: number[], q = 0.1) => [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))];

export type StrokeStats = { dir: SwipeDir; along: number; across: number; peak: number; ms: number; cameOutAs: SwipeDir | null };

export function statsOf(recs: Recording[]): StrokeStats[] {
  return recs.map((rec) => {
    const s = strokeOf(rec);
    if (!s) return { dir: rec.dir, along: 0, across: 0, peak: 0, ms: 0, cameOutAs: null };
    const [ux, uy] = AXIS[rec.dir];
    return {
      dir: rec.dir,
      along: along(s, rec.dir), // travel in the intended direction
      across: Math.abs(s.dx * uy - s.dy * ux), // sideways drift
      peak: s.peak,
      ms: s.ms,
      cameOutAs: s.dir,
    };
  });
}

/** Detector settings that fit this person's swipes, with a safety margin. */
export function deriveOptions(recs: Recording[]): SwipeOptions {
  const st = statsOf(recs).filter((s) => s.along > 0.08);
  if (st.length < 4) return DEFAULT_SWIPE;
  // Loosen thresholds for gentler swipers; never demand more speed than the defaults do.
  const minPeakSpeed = clamp(0.6 * low(st.map((s) => s.peak)), 0.5, DEFAULT_SWIPE.minPeakSpeed);
  const startSpeed = clamp(0.75 * minPeakSpeed, 0.35, 0.7);
  return {
    ...DEFAULT_SWIPE,
    distance: clamp(0.65 * low(st.map((s) => s.along)), 0.15, 0.36),
    minPeakSpeed,
    startSpeed,
    endSpeed: startSpeed / 2,
    dominance: clamp(0.85 * low(st.map((s) => s.along / Math.max(s.across, 1e-3))), 1.1, 1.6),
    maxStrokeMs: clamp(1.5 * Math.max(...st.map((s) => s.ms)), 800, 2000),
  };
}

/**
 * How many recordings come out as exactly the intended swipe and nothing else (the hand coming
 * back included). The session is replayed as one continuous stream, as the kiosk would see it.
 */
export function score(recs: Recording[], options: SwipeOptions) {
  const perDir = {} as Record<SwipeDir, { ok: number; n: number }>;
  const swipes = replay(recs.flatMap((r) => r.frames), options);
  let ok = 0;
  for (const rec of recs) {
    const from = rec.frames[0]?.[0] ?? 0;
    const to = rec.frames[rec.frames.length - 1]?.[0] ?? 0;
    const got = swipes.filter((s) => s.at >= from && s.at <= to).map((s) => s.dir);
    const good = got.length === 1 && got[0] === rec.dir;
    const d = (perDir[rec.dir] ??= { ok: 0, n: 0 });
    d.n++;
    if (good) {
      d.ok++;
      ok++;
    }
  }
  return { ok, n: recs.length, perDir };
}

// Taught settings are kept on this machine (the kiosk) between visits.
const KEY = "kiosk.swipeOptions";

export function loadSwipeOptions(): SwipeOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved ? { ...DEFAULT_SWIPE, ...saved } : DEFAULT_SWIPE;
  } catch {
    return DEFAULT_SWIPE;
  }
}

export function saveSwipeOptions(options: SwipeOptions | null) {
  try {
    if (options) localStorage.setItem(KEY, JSON.stringify(options));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private window): settings last until the page reloads.
  }
}

export function hasSavedSwipeOptions() {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

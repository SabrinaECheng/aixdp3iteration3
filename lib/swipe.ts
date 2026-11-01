// Turns a stream of hand positions into discrete up / down / left / right swipes.
//
// Each swipe is judged as one whole stroke: it starts when the hand speeds up,
// ends when the hand slows down again (or leaves the frame), and only then is
// the direction decided from where the stroke began to where it ended. That
// treats fast, slow and curved swipes alike.
//
// Strokes that follow each other closely (a wind-up the other way, the swipe,
// a quick return) are judged together as one burst, and only the main one counts:
// the first move, unless a later one is clearly bigger (a wind-up is smaller than
// the swipe after it).

export type SwipeDir = "up" | "down" | "left" | "right";

export type SwipeOptions = {
  smoothMs: number; // time constant of the jitter smoothing
  speedSpanMs: number; // measure speed over this much movement
  startSpeed: number; // a stroke starts above this speed (frame heights / s)
  endSpeed: number; // ...and ends once below this speed
  endHoldMs: number; // ...for at least this long
  maxStrokeMs: number; // a stroke longer than this is judged anyway
  distance: number; // minimum travel along the main axis, in frame heights
  minPeakSpeed: number; // the stroke must reach this speed somewhere (rules out slow repositioning)
  dominance: number; // main axis must beat the other axis by this factor
  cooldownMs: number; // ignore new strokes this long after a swipe
  returnMs: number; // the opposite direction this soon after a swipe is the hand coming back
  returnNearMs: number; // ...and up to this long if it starts where the last swipe ended
  returnNear: number; // how close (frame heights) counts as "where the last swipe ended"
  groupGapMs: number; // strokes closer together than this are one burst; decide once it's over
  minMove: number; // strokes shorter than this (frame heights) are just jitter
  overtake: number; // a later move in a burst only wins if it's this many times bigger (speed × distance)
  maxBurst: number; // a burst with more moves than this is waving or fidgeting, not a swipe
  maxGapMs: number; // tracking lost longer than this ends the stroke / starts fresh
  absentMs: number; // gone at least this long counts as the hand (re)appearing...
  warmupMs: number; // ...and strokes starting this soon after are ignored (raising it into view)
  exitFactor: number; // a stroke cut off by leaving the view needs only this share of the distance
};

export const DEFAULT_SWIPE: SwipeOptions = {
  smoothMs: 30,
  speedSpanMs: 80,
  startSpeed: 0.7,
  endSpeed: 0.35,
  endHoldMs: 60,
  maxStrokeMs: 1200,
  distance: 0.22,
  minPeakSpeed: 0.85,
  dominance: 1.3,
  cooldownMs: 250,
  returnMs: 1500,
  returnNearMs: 3000,
  returnNear: 0.15,
  groupGapMs: 300,
  minMove: 0.1,
  overtake: 2,
  maxBurst: 3,
  maxGapMs: 250,
  absentMs: 500,
  warmupMs: 300,
  exitFactor: 0.75,
};

export const OPPOSITE: Record<SwipeDir, SwipeDir> = { up: "down", down: "up", left: "right", right: "left" };

export type Swipe = {
  dir: SwipeDir;
  dx: number; // travel, in frame heights
  dy: number;
  peak: number; // top speed, frame heights / s
  ms: number; // how long the stroke took
  at: number; // when it ended
};

// x/y are smoothed (for steady speed readings); rx/ry are raw (for true distance travelled).
type Pt = { t: number; x: number; y: number; rx: number; ry: number };

type Stroke = {
  dir: SwipeDir; // main axis direction
  dx: number;
  dy: number;
  travel: number;
  peak: number;
  start: Pt;
  end: Pt;
  reason: string | null; // why it can't be a swipe on its own, or null if it can
};

export class SwipeDetector {
  private hist: Pt[] = []; // recent smoothed positions
  private lastT = -Infinity;
  private acquiredAt = -Infinity;
  private lockUntil = 0;
  private stroke: { start: Pt; end: Pt; peak: number; slowSince: number | null } | null = null;
  // The last real movement, accepted or not: the hand coming back from it is never a swipe.
  private last: { dir: SwipeDir; t: number; end: Pt; returned: boolean } | null = null;
  // The current burst of strokes, decided once the hand has been calm for groupGapMs.
  private group: { strokes: Stroke[]; lastEnd: number; lastBefore: SwipeDetector["last"] } | null = null;
  /** Why the most recent stroke didn't count (for on-screen tuning). */
  miss: string | null = null;

  constructor(private o: SwipeOptions = DEFAULT_SWIPE) {}

  /** A tracked hand position; x and y in frame-height units (multiply normalised x by the video aspect). */
  push(t: number, x: number, y: number): Swipe | null {
    const o = this.o;
    if (t - this.lastT > o.maxGapMs) {
      this.finish(true); // the hand was gone: judge any stroke up to where it was last seen
      this.hist = [];
      if (t - this.lastT > o.absentMs) this.acquiredAt = t;
    }

    // Smooth out frame-to-frame jitter.
    const prev = this.hist[this.hist.length - 1];
    const a = prev ? 1 - Math.exp(-(t - prev.t) / o.smoothMs) : 1;
    const p = prev ? { t, x: prev.x + (x - prev.x) * a, y: prev.y + (y - prev.y) * a, rx: x, ry: y } : { t, x, y, rx: x, ry: y };
    this.lastT = t;
    this.hist.push(p);
    while (this.hist.length > 2 && t - this.hist[1].t > Math.max(o.speedSpanMs * 3, 300)) this.hist.shift();

    const speed = this.speedAt(this.hist.length - 1);

    if (!this.stroke) {
      if (speed > o.startSpeed) {
        // Walk back to where the hand actually started moving.
        let i = this.hist.length - 1;
        while (i > 0 && this.stepSpeed(i) > o.endSpeed) i--;
        this.stroke = { start: this.hist[i], end: p, peak: speed, slowSince: null };
      }
      return this.decide(t);
    }

    const s = this.stroke;
    // The hand reversed without pausing (wind-up straight into the swipe, or a swipe straight into
    // the return): split here so each movement is judged on its own.
    const [vx, vy] = this.velAt(this.hist.length - 1);
    const sx = s.end.x - s.start.x;
    const sy = s.end.y - s.start.y;
    const along = vx * sx + vy * sy;
    if (speed > o.startSpeed && Math.hypot(sx, sy) > o.minMove && along < -0.5 * speed * Math.hypot(sx, sy)) {
      const turn = s.end;
      this.finish();
      this.stroke = { start: turn, end: p, peak: speed, slowSince: null };
      return this.decide(t);
    }
    s.end = p;
    s.peak = Math.max(s.peak, speed);
    if (speed < o.endSpeed) s.slowSince ??= t;
    else s.slowSince = null;
    if ((s.slowSince !== null && t - s.slowSince >= o.endHoldMs) || t - s.start.t > o.maxStrokeMs) this.finish();
    return this.decide(t);
  }

  /** No hand this frame. Ends a stroke once the hand has been gone a moment (e.g. swiped out of view). */
  lost(t: number): Swipe | null {
    if (this.stroke && t - this.lastT > this.o.maxGapMs) this.finish(true);
    return this.decide(t);
  }

  private speedAt(i: number) {
    const [vx, vy] = this.velAt(i);
    return Math.hypot(vx, vy);
  }

  private velAt(i: number): [number, number] {
    const p = this.hist[i];
    let j = i - 1;
    while (j > 0 && p.t - this.hist[j].t < this.o.speedSpanMs) j--;
    if (j < 0) return [0, 0];
    const q = this.hist[j];
    const dt = Math.max((p.t - q.t) / 1000, 1e-3);
    return [(p.x - q.x) / dt, (p.y - q.y) / dt];
  }

  private stepSpeed(i: number) {
    const p = this.hist[i];
    const q = this.hist[i - 1];
    return Math.hypot(p.x - q.x, p.y - q.y) / Math.max((p.t - q.t) / 1000, 1e-3);
  }

  /** Close the current stroke and add it to the burst. */
  private finish(lostHand = false) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    const o = this.o;
    const dx = s.end.rx - s.start.rx;
    const dy = s.end.ry - s.start.ry;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const travel = Math.max(ax, ay);
    if (travel < o.minMove) return;
    const dir: SwipeDir = ax >= ay ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";

    // Movement while the hand is still coming into view is someone raising their hand, and a
    // downward movement that leaves the view is someone lowering their arm: neither is a swipe.
    // Swiping out of the top or sides cuts the stroke short, so ask for a bit less there.
    const entering = s.start.t - this.acquiredAt < o.warmupMs;
    const exiting = lostHand && s.slowSince === null;
    const need = exiting ? o.distance * o.exitFactor : o.distance;
    const minor = Math.min(ax, ay);
    const reason = entering
      ? "hand was just coming into view"
      : exiting && dir === "down"
        ? "arm lowered out of view"
        : s.start.t < this.lockUntil
          ? "too soon after the last swipe"
          : travel < need
            ? `too short (${travel.toFixed(2)} of ${need.toFixed(2)})`
            : s.peak < o.minPeakSpeed
              ? `too slow (${s.peak.toFixed(1)} of ${o.minPeakSpeed})`
              : !(travel > minor * o.dominance)
                ? `diagonal (dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)})`
                : null;

    const stroke: Stroke = { dir, dx, dy, travel, peak: s.peak, start: s.start, end: s.end, reason };
    this.group ??= { strokes: [], lastEnd: 0, lastBefore: this.last };
    this.group.strokes.push(stroke);
    this.group.lastEnd = s.end.t;
  }

  /** Once a burst is over, fire its main stroke (if it isn't the hand coming back). */
  private decide(t: number): Swipe | null {
    const g = this.group;
    if (!g || this.stroke || t - g.lastEnd < this.o.groupGapMs) return null;
    this.group = null;
    const o = this.o;
    // The first move wins unless a later one is clearly bigger: a wind-up is smaller than the swipe
    // after it, and a quick return has to be clearly bigger than the swipe to win.
    const size = (s: Stroke) => s.peak * s.travel;
    const pick = (xs: Stroke[]) => xs.reduce<Stroke | null>((a, b) => (!a || size(b) > size(a) * o.overtake ? b : a), null);
    const top = pick(g.strokes)!;
    const best = pick(g.strokes.filter((s) => !s.reason));
    // The hand coming back from the last movement, even one that didn't count (e.g. an up swipe
    // that started below the view): otherwise a missed up turns into a "down" on the way back.
    const last = g.lastBefore;
    const isReturn = (s: Stroke) => {
      // Once the hand has come back, the next opposite movement is a real swipe (often after a wind-up).
      if (!last || last.returned || s.dir !== OPPOSITE[last.dir]) return false;
      const since = s.start.t - last.t;
      const fromEnd = Math.hypot(s.start.rx - last.end.rx, s.start.ry - last.end.ry);
      return since < o.returnMs || (since < o.returnNearMs && fromEnd < o.returnNear);
    };
    // Remember real movements (even ones too small to count), never the hand coming back:
    // that would block the next swipe in the same direction as the last one.
    const remember = (s: Stroke) => {
      if (s.travel >= o.distance * 0.5 && !isReturn(s)) this.last = { dir: s.dir, t: s.end.t, end: s.end, returned: false };
    };
    const cameBack = g.strokes.some(isReturn);

    if (!best) {
      remember(top);
      if (cameBack && this.last === last && last) last.returned = true;
      return this.reject(top.reason!);
    }
    // A swipe burst is at most wind-up, swipe, quick return; more back-and-forth is waving.
    if (g.strokes.length > o.maxBurst) return this.reject(`waving or fidgeting (${g.strokes.length} moves)`);
    if (isReturn(best)) {
      last!.returned = true;
      return this.reject(`${best.dir} ignored: hand coming back from ${last!.dir}`);
    }
    remember(best);
    // A quick return in the same burst means the hand has already come back.
    if (this.last && g.strokes.some((s) => s.start.t >= best.end.t && s.dir === OPPOSITE[best.dir])) this.last.returned = true;
    this.lockUntil = best.end.t + o.cooldownMs;
    this.miss = null;
    return { dir: best.dir, dx: best.dx, dy: best.dy, peak: best.peak, ms: best.end.t - best.start.t, at: best.end.t };
  }

  private reject(why: string) {
    this.miss = why;
    return null;
  }
}

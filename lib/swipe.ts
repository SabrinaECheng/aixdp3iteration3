// Turns a stream of hand positions into discrete up / down / left / right swipes.
//
// Each swipe is judged as one whole stroke: it starts when the hand speeds up,
// ends when the hand slows down again (or leaves the frame), and only then is
// the direction decided from where the stroke began to where it ended. That
// treats fast, slow and curved swipes alike and decides once per swipe.

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
  maxGapMs: number; // tracking lost longer than this ends the stroke / starts fresh
  absentMs: number; // gone at least this long counts as the hand (re)appearing...
  warmupMs: number; // ...and strokes starting this soon after are ignored (raising it into view)
  exitFactor: number; // a stroke cut off by the hand leaving the view needs only this share of the distance
};

export const DEFAULT_SWIPE: SwipeOptions = {
  smoothMs: 30,
  speedSpanMs: 80,
  startSpeed: 0.7,
  endSpeed: 0.35,
  endHoldMs: 60,
  maxStrokeMs: 1200,
  distance: 0.3,
  minPeakSpeed: 0.85,
  dominance: 1.3,
  cooldownMs: 250,
  returnMs: 1500,
  returnNearMs: 3000,
  returnNear: 0.15,
  maxGapMs: 250,
  absentMs: 500,
  warmupMs: 300,
  exitFactor: 0.75,
};

const OPPOSITE: Record<SwipeDir, SwipeDir> = { up: "down", down: "up", left: "right", right: "left" };

export type Swipe = { dir: SwipeDir; dx: number; dy: number };

// x/y are smoothed (for steady speed readings); rx/ry are raw (for true distance travelled).
type Pt = { t: number; x: number; y: number; rx: number; ry: number };

export class SwipeDetector {
  private hist: Pt[] = []; // recent smoothed positions
  private lastT = -Infinity;
  private acquiredAt = -Infinity;
  private lockUntil = 0;
  private stroke: { start: Pt; end: Pt; peak: number; slowSince: number | null } | null = null;
  private last: { dir: SwipeDir; t: number; end: Pt } | null = null;
  /** Why the most recent stroke didn't count (for on-screen tuning). */
  miss: string | null = null;

  constructor(private o: SwipeOptions = DEFAULT_SWIPE) {}

  /** A tracked hand position; x and y in frame-height units (multiply normalised x by the video aspect). */
  push(t: number, x: number, y: number): Swipe | null {
    const o = this.o;
    let result: Swipe | null = null;
    if (t - this.lastT > o.maxGapMs) {
      result = this.finish(true); // the hand was gone: judge any stroke up to where it was last seen
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
      return result;
    }

    const s = this.stroke;
    s.end = p;
    s.peak = Math.max(s.peak, speed);
    if (speed < o.endSpeed) s.slowSince ??= t;
    else s.slowSince = null;
    if ((s.slowSince !== null && t - s.slowSince >= o.endHoldMs) || t - s.start.t > o.maxStrokeMs) {
      return this.finish() ?? result;
    }
    return result;
  }

  /** No hand this frame. Ends a stroke once the hand has been gone a moment (e.g. swiped out of view). */
  lost(t: number): Swipe | null {
    if (this.stroke && t - this.lastT > this.o.maxGapMs) return this.finish(true);
    return null;
  }

  private speedAt(i: number) {
    const p = this.hist[i];
    let j = i - 1;
    while (j > 0 && p.t - this.hist[j].t < this.o.speedSpanMs) j--;
    if (j < 0) return 0;
    const q = this.hist[j];
    return Math.hypot(p.x - q.x, p.y - q.y) / Math.max((p.t - q.t) / 1000, 1e-3);
  }

  private stepSpeed(i: number) {
    const p = this.hist[i];
    const q = this.hist[i - 1];
    return Math.hypot(p.x - q.x, p.y - q.y) / Math.max((p.t - q.t) / 1000, 1e-3);
  }

  private finish(lostHand = false): Swipe | null {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return null;
    const o = this.o;
    const dx = s.end.rx - s.start.rx;
    const dy = s.end.ry - s.start.ry;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const travel = Math.max(ax, ay);
    // Swiping out of the camera's view cuts the stroke short, so ask for a bit less.
    const need = lostHand && s.slowSince === null ? o.distance * o.exitFactor : o.distance;

    if (s.start.t - this.acquiredAt < o.warmupMs) return this.reject("hand was just coming into view");
    if (s.start.t < this.lockUntil) return this.reject("too soon after the last swipe");
    if (travel < need) return this.reject(`too short (${travel.toFixed(2)} of ${need.toFixed(2)})`);
    if (s.peak < o.minPeakSpeed) return this.reject(`too slow (${s.peak.toFixed(1)} of ${o.minPeakSpeed})`);

    let dir: SwipeDir | null = null;
    if (ax > ay * o.dominance) dir = dx > 0 ? "right" : "left";
    else if (ay > ax * o.dominance) dir = dy > 0 ? "down" : "up";
    if (!dir) return this.reject(`diagonal (dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)})`);

    if (this.last && dir === OPPOSITE[this.last.dir]) {
      const since = s.start.t - this.last.t;
      const fromEnd = Math.hypot(s.start.rx - this.last.end.rx, s.start.ry - this.last.end.ry);
      if (since < o.returnMs || (since < o.returnNearMs && fromEnd < o.returnNear)) {
        return this.reject(`${dir} ignored: hand coming back from ${this.last.dir}`);
      }
    }
    this.last = { dir, t: s.end.t, end: s.end };
    this.lockUntil = s.end.t + o.cooldownMs;
    this.miss = null;
    return { dir, dx, dy };
  }

  private reject(why: string) {
    this.miss = why;
    return null;
  }
}

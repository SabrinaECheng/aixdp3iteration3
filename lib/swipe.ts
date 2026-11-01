// Turns a stream of hand positions into discrete up / down / left / right swipes.

export type SwipeDir = "up" | "down" | "left" | "right";

export type SwipeOptions = {
  windowMs: number; // look this far back for the movement
  distance: number; // minimum travel, in frame heights
  dominance: number; // main axis must beat the other axis by this factor
  cooldownMs: number; // ignore everything for this long after a swipe
  returnMs: number; // the opposite direction this soon after a swipe is the hand coming back
  returnNearMs: number; // ...and up to this long if it starts where the last swipe ended
  returnNear: number; // how close (frame heights) counts as "where the last swipe ended"
  maxGapMs: number; // tracking lost longer than this → start fresh (no jumps across the gap)
  warmupMs: number; // ignore movement right after the hand appears (raising it into view)
};

export const DEFAULT_SWIPE: SwipeOptions = {
  windowMs: 400,
  distance: 0.3,
  dominance: 1.3,
  cooldownMs: 500,
  returnMs: 1500,
  returnNearMs: 3000,
  returnNear: 0.15,
  maxGapMs: 150,
  warmupMs: 300,
};

const OPPOSITE: Record<SwipeDir, SwipeDir> = { up: "down", down: "up", left: "right", right: "left" };

export type Swipe = { dir: SwipeDir; dx: number; dy: number };

type Pt = { t: number; x: number; y: number };

export class SwipeDetector {
  private pts: Pt[] = [];
  private lastT = -Infinity;
  private acquiredAt = 0;
  private lockUntil = 0;
  private last: { dir: SwipeDir; t: number; end: Pt } | null = null;
  /** Why the most recent near-swipe didn't count (for on-screen tuning). */
  miss: string | null = null;

  constructor(private o: SwipeOptions = DEFAULT_SWIPE) {}

  /** x and y in frame-height units (multiply normalised x by the video aspect). */
  push(t: number, x: number, y: number): Swipe | null {
    const o = this.o;
    if (t - this.lastT > o.maxGapMs) {
      this.pts = [];
      this.acquiredAt = t;
    }
    this.lastT = t;

    if (t - this.acquiredAt < o.warmupMs) {
      this.pts = [{ t, x, y }];
      return null;
    }
    this.pts.push({ t, x, y });
    while (this.pts.length && t - this.pts[0].t > o.windowMs) this.pts.shift();
    if (t < this.lockUntil || this.pts.length < 2) return null;

    const first = this.pts[0];
    const dx = x - first.x;
    const dy = y - first.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const travel = Math.max(ax, ay);
    if (travel < o.distance) {
      if (travel > o.distance * 0.6) this.miss = `too short (${travel.toFixed(2)} of ${o.distance})`;
      return null;
    }

    let dir: SwipeDir | null = null;
    if (ax > ay * o.dominance) dir = dx > 0 ? "right" : "left";
    else if (ay > ax * o.dominance) dir = dy > 0 ? "down" : "up";
    if (!dir) {
      this.miss = `diagonal (dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)})`;
      return null;
    }

    this.pts = [];
    if (this.last && dir === OPPOSITE[this.last.dir]) {
      const since = t - this.last.t;
      const fromEnd = Math.hypot(first.x - this.last.end.x, first.y - this.last.end.y);
      if (since < o.returnMs || (since < o.returnNearMs && fromEnd < o.returnNear)) {
        this.miss = `${dir} ignored: hand coming back from ${this.last.dir}`;
        return null;
      }
    }
    this.last = { dir, t, end: { t, x, y } };
    this.lockUntil = t + o.cooldownMs;
    this.miss = null;
    return { dir, dx, dy };
  }
}

// Direction gestures from where the hand goes, not how fast it moves.
//
// The hand "arms" by resting at its resting spot (the middle of the view, or
// wherever this visitor naturally holds their hand). Moving from there out
// into the top, bottom, left or right zone fires that direction once, at the
// end of the reach (when the hand stops or turns back). To fire
// again the hand has to come back and rest, so the hand coming back, winding
// up, or waving through the middle never fires anything. Speed doesn't matter:
// a flick and a slow reach both work.

import type { SwipeDir } from "./swipe";

export type ReachOptions = {
  reach: number; // how far from the resting spot a zone starts, in frame heights
  minReach: number; // ...never less than this, even when the resting spot is near the frame's edge
  armRadius: number; // within this of the resting spot counts as "in the middle"
  armMs: number; // rest in the middle this long to arm
  dominance: number; // main axis must beat the other by this factor
  stillSpeed: number; // slower than this (frame heights / s, over stillSpanMs) counts as resting
  stillSpanMs: number; // measured over this long, so tracking jitter doesn't count as moving
  settleMs: number; // a new visitor's first rest this long around the middle becomes their resting spot
  rehomeMs: number; // later, resting this long somewhere else moves it (longer than holding a reach to read)
  homeDrift: number; // how quickly the resting spot follows small shifts near it (per second)
  maxGapMs: number; // tracking lost longer than this disarms
  goneMs: number; // gone this long: treat whoever comes next as a new visitor
  peakMs: number; // fire once the hand has gone no further into the zone for this long
  maxTravelMs: number; // the hand must reach the zone this soon after leaving its resting spot
  edge: number; // keep zones this far inside the camera frame (normalised)
};

export const DEFAULT_REACH: ReachOptions = {
  reach: 0.22,
  minReach: 0.12,
  armRadius: 0.1,
  armMs: 150,
  dominance: 1.2,
  stillSpeed: 0.3,
  stillSpanMs: 150,
  settleMs: 500,
  rehomeMs: 4000,
  homeDrift: 1,
  maxGapMs: 250,
  goneMs: 1500,
  peakMs: 80,
  maxTravelMs: 1500,
  edge: 0.04,
};

// Where a resting spot may be (normalised camera coords): around the middle, never up in a zone.
const HOME_BOX = { x: [0.25, 0.75], y: [0.3, 0.85] };
const DEFAULT_HOME = { x: 0.5, y: 0.55 };

export type ReachState = {
  armed: boolean;
  /** How far the hand is toward the nearest zone, 0..1 (for lighting the on-screen hints). */
  toward: SwipeDir | null;
  progress: number;
};

export class ReachDetector {
  private home = { ...DEFAULT_HOME };
  private homeSet = false; // this visitor's resting spot is known
  private armed = false;
  private stillSince: number | null = null;
  private nearSince: number | null = null;
  private needReturn = false; // after firing, the hand must come back before the resting spot can move
  private leftHomeAt: number | null = null;
  private drifted = false; // took too long to get there: not a reach until the hand comes back
  private peak: { dir: SwipeDir; dist: number; t: number } | null = null; // furthest point reached inside a zone
  private lastT = -Infinity;
  private hist: { t: number; x: number; y: number }[] = [];
  private lastAim: { dir: SwipeDir; progress: number; clear: boolean } | null = null;
  state: ReachState = { armed: false, toward: null, progress: 0 };
  /** Why the last movement didn't fire (for on-screen tuning). */
  miss: string | null = null;

  constructor(private o: ReachOptions = DEFAULT_REACH) {}

  /** Palm position, normalised 0..1 and mirrored; aspect = video width / height. */
  push(t: number, x: number, y: number, aspect: number): SwipeDir | null {
    const o = this.o;
    if (t - this.lastT > o.goneMs) {
      this.home = { ...DEFAULT_HOME }; // a new visitor
      this.homeSet = false;
      this.needReturn = false;
    }
    if (t - this.lastT > o.maxGapMs) this.disarm();
    this.hist.push({ t, x, y });
    while (this.hist.length > 2 && t - this.hist[1].t >= o.stillSpanMs) this.hist.shift();
    const p = this.hist[0];
    const speed = t - p.t >= o.stillSpanMs / 2 ? Math.hypot((x - p.x) * aspect, y - p.y) / ((t - p.t) / 1000) : Infinity;
    this.lastT = t;

    const still = speed < o.stillSpeed;
    if (still) this.stillSince ??= t;
    else this.stillSince = null;

    let dx = (x - this.home.x) * aspect;
    let dy = y - this.home.y;
    const near = Math.hypot(dx, dy) < o.armRadius;
    if (near) this.needReturn = false;
    if (near && still) this.nearSince ??= t;
    else this.nearSince = null;
    if (near) {
      this.leftHomeAt = null;
      this.peak = null;
      this.drifted = false;
    } else this.leftHomeAt ??= t;

    const inBox = x > HOME_BOX.x[0] && x < HOME_BOX.x[1] && y > HOME_BOX.y[0] && y < HOME_BOX.y[1];
    const restedFor = this.stillSince === null ? 0 : t - this.stillSince;
    if (!this.armed && this.nearSince !== null && t - this.nearSince >= o.armMs) {
      this.homeSet = true;
      this.arm();
    } else if (!near && !this.needReturn && inBox && restedFor >= (this.homeSet ? o.rehomeMs : o.settleMs)) {
      // Where this visitor holds their hand (tall, short, off to one side) is their resting spot.
      // Holding still after a reach (e.g. to read) is shorter than rehomeMs, so it never moves it.
      this.home = { x, y };
      this.homeSet = true;
      dx = dy = 0;
      this.arm();
    } else if (this.armed && still && near) {
      // Follow small shifts of a resting hand.
      const a = Math.min((o.homeDrift * (t - (this.hist[this.hist.length - 2]?.t ?? t))) / 1000, 1);
      this.home.x += (x - this.home.x) * a;
      this.home.y += (y - this.home.y) * a;
    }

    const aim = this.aim(dx, dy, aspect);
    this.lastAim = aim;
    this.state = { armed: this.armed, toward: aim?.dir ?? null, progress: this.armed ? (aim?.progress ?? 0) : 0 };

    if (aim && aim.progress >= 1) {
      if (!this.armed) this.miss = "not ready: rest your hand in the middle first";
      else if (!aim.clear) this.miss = `diagonal (dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)})`;
      else if (this.drifted || (!this.peak && this.leftHomeAt !== null && t - this.leftHomeAt > o.maxTravelMs)) {
        this.drifted = true;
        this.peak = null;
        this.miss = "too slow: drifted there";
      } else {
        // Track the furthest point of the reach; fire when it stops going further (hand stops or
        // turns back). A hand passing straight through, like an arm being lowered, never fires.
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (!this.peak || this.peak.dir !== aim.dir || dist > this.peak.dist + 0.005) this.peak = { dir: aim.dir, dist, t };
      }
    }
    if (this.armed && this.peak && t - this.peak.t >= o.peakMs) {
      const dir = this.peak.dir;
      this.disarm();
      this.needReturn = true;
      return dir;
    }
    return null;
  }

  /** No hand this frame. Reaching up past the top of the view still counts; dropping out the bottom doesn't. */
  lost(t: number): SwipeDir | null {
    if (t - this.lastT <= this.o.maxGapMs) return null;
    const aim = this.lastAim;
    const fire = this.armed && aim && aim.dir === "up" && aim.clear && aim.progress >= 0.6 ? aim.dir : null;
    this.disarm();
    if (fire) this.needReturn = true;
    return fire;
  }

  private arm() {
    this.armed = true;
    this.miss = null;
  }

  private disarm() {
    this.hist = [];
    this.armed = false;
    this.stillSince = null;
    this.nearSince = null;
    this.leftHomeAt = null;
    this.peak = null;
    this.drifted = false;
    this.lastAim = null;
    this.state = { armed: false, toward: null, progress: 0 };
  }

  /** Which zone the hand is heading for, and how far along (1 = inside it). */
  private aim(dx: number, dy: number, aspect: number) {
    const o = this.o;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 1e-3) return null;
    const dir: SwipeDir = ax >= ay ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    // Room between the resting spot and the frame edge in that direction.
    const room = {
      left: (this.home.x - o.edge) * aspect,
      right: (1 - o.edge - this.home.x) * aspect,
      up: this.home.y - o.edge,
      down: 1 - o.edge - this.home.y,
    }[dir];
    // Downward exits don't count (that's an arm being lowered), so keep the bottom zone well inside the view.
    const need = Math.max(Math.min(o.reach, room * (dir === "down" ? 0.7 : 0.85)), o.minReach);
    const main = Math.max(ax, ay);
    const other = Math.min(ax, ay);
    return { dir, progress: Math.min(main / need, 1), clear: main > other * o.dominance };
  }
}

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
  distance: number; // minimum travel for a left / right swipe, in frame heights
  distanceVertical: number; // ...and for an up / down swipe (people swipe shorter vertically)
  returnSpeed: number; // a movement this much faster than the one before...
  returnSize: number; // ...and this much longer isn't the hand coming back from it: it's a new swipe
  minPeakSpeed: number; // the stroke must reach this speed somewhere (rules out slow repositioning)
  dominance: number; // main axis must beat the other axis by this factor
  cooldownMs: number; // ignore new strokes this long after a swipe
  returnMs: number; // the opposite direction this soon after a swipe is the hand coming back
  returnNearMs: number; // ...and up to this long if it starts where the last swipe ended
  returnNear: number; // how close (frame heights) counts as "where the last swipe ended"
  groupGapMs: number; // strokes closer together than this are one burst; decide once it's over...
  maxWaitMs: number; // ...but never wait longer than this after the first real move, even if the hand keeps moving
  fastSpeed: number; // a valid move at least this fast (frame heights / s), starting from a resting hand,
  // is decided as soon as it's clearly done (waving never starts from rest, so it still waits)
  restMs: number; // no movement for this long before a stroke counts as starting from rest
  minMove: number; // strokes shorter than this (frame heights) are just jitter
  overtake: number; // a later move in a burst only wins if it's this many times bigger (speed × distance)
  waveWindowMs: number; // within this long, this many direction reversals (waving)...
  waveReversals: number;
  fidgetMoves: number; // ...or this many moves of any kind (circling, fidgeting) isn't a swipe
  maxGapMs: number; // tracking lost longer than this ends the stroke / starts fresh
  absentMs: number; // gone at least this long counts as the hand (re)appearing...
  warmupMs: number; // ...and strokes starting this soon after are ignored (raising it into view)
  exitFactor: number; // a stroke cut off by leaving the view needs only this share of the distance
};

export const DEFAULT_SWIPE: SwipeOptions = {
  smoothMs: 30,
  speedSpanMs: 80,
  startSpeed: 0.4,
  endSpeed: 0.2,
  endHoldMs: 60,
  maxStrokeMs: 1800,
  distance: 0.13,
  distanceVertical: 0.1,
  returnSpeed: 1.5,
  returnSize: 1.3,
  minPeakSpeed: 0.85,
  dominance: 1.3,
  cooldownMs: 250,
  returnMs: 1500,
  returnNearMs: 3000,
  returnNear: 0.15,
  groupGapMs: 300,
  maxWaitMs: 400,
  fastSpeed: 1.4,
  restMs: 250,
  minMove: 0.1,
  overtake: 2,
  waveWindowMs: 1500,
  waveReversals: 3,
  fidgetMoves: 4,
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
  slowOnly: boolean; // a clear swipe in every way except speed (maybe a slow, deliberate sweep)
};

export class SwipeDetector {
  private hist: Pt[] = []; // recent smoothed positions
  private lastT = -Infinity;
  private acquiredAt = -Infinity;
  private lockUntil = 0;
  // far = the point furthest from the start, so a flick that springs back still counts in full.
  // judged = already decided early (a fast swipe); the rest of the movement plays out without counting again.
  private stroke: { start: Pt; end: Pt; far: Pt; peak: number; slowSince: number | null; judged: boolean; fromRest: boolean } | null = null;
  private lastMoveEnd = -Infinity;
  // The last real movement, accepted or not: the hand coming back from it is never a swipe.
  private last: {
    dir: SwipeDir;
    t: number;
    start: Pt;
    end: Pt;
    peak: number;
    travel: number;
    returned: boolean;
    slowOnly: boolean; // didn't fire for being slow: fire it if the hand now comes back (it was a sweep)
  } | null = null;
  // The current burst of strokes, decided once the hand has been calm for groupGapMs (sooner for a fast swipe).
  private group: {
    strokes: Stroke[];
    lastEnd: number;
    firstValidEnd: number | null;
    now: boolean; // a fast, clear swipe: decide straight away
    lastBefore: SwipeDetector["last"];
  } | null = null;
  // Recent moves of any kind, to spot back-and-forth waving.
  private recent: { dir: SwipeDir; t: number }[] = [];
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
        const start = this.hist[i];
        this.stroke = { start, end: p, far: p, peak: speed, slowSince: null, judged: false, fromRest: start.t - this.lastMoveEnd > o.restMs };
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
      this.stroke = { start: turn, end: p, far: p, peak: speed, slowSince: null, judged: false, fromRest: false };
      return this.decide(t);
    }
    s.end = p;
    const reach = (q: Pt) => Math.hypot(q.rx - s.start.rx, q.ry - s.start.ry);
    if (reach(p) > reach(s.far)) s.far = p;
    s.peak = Math.max(s.peak, speed);
    if (speed < o.endSpeed) s.slowSince ??= t;
    else s.slowSince = null;
    // A fast swipe that has gone far enough is over once the hand is clearly slowing down:
    // don't wait for it to come to a full stop before reacting.
    const far = Math.max(Math.abs(s.far.rx - s.start.rx), Math.abs(s.far.ry - s.start.ry));
    if (!s.judged && s.fromRest && s.peak >= o.fastSpeed && speed < s.peak * 0.5 && far >= Math.min(o.distance, o.distanceVertical)) {
      this.judge(s, false);
      s.judged = true;
    }
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

  /** Close the current stroke and add it to the burst (unless it was already judged early). */
  private finish(lostHand = false) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    this.lastMoveEnd = s.end.t;
    if (!s.judged) this.judge(s, lostHand);
  }

  /** Add a stroke (finished, or a fast swipe still slowing down) to the burst. */
  private judge(s: NonNullable<SwipeDetector["stroke"]>, lostHand: boolean) {
    const o = this.o;
    // Measure to the furthest point: a quick flick often springs back a little before the hand stops.
    const dx = s.far.rx - s.start.rx;
    const dy = s.far.ry - s.start.ry;
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
    const base = dir === "up" || dir === "down" ? o.distanceVertical : o.distance;
    const need = exiting ? base * o.exitFactor : base;
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

    const slowOnly = reason !== null && reason.startsWith("too slow") && travel > minor * o.dominance;
    const stroke: Stroke = { dir, dx, dy, travel, peak: s.peak, start: s.start, end: { ...s.far, t: s.end.t }, reason, slowOnly };
    const g = (this.group ??= { strokes: [], lastEnd: 0, firstValidEnd: null, now: false, lastBefore: this.last });
    g.strokes.push(stroke);
    g.lastEnd = s.end.t;
    if (!reason) {
      g.firstValidEnd ??= s.end.t;
      if (s.peak >= o.fastSpeed && s.fromRest) g.now = true;
    }
    this.recent.push({ dir, t: s.end.t });
    while (this.recent.length && s.end.t - this.recent[0].t > o.waveWindowMs) this.recent.shift();
  }

  /** Once a burst is over, fire its main stroke (if it isn't the hand coming back). */
  private decide(t: number): Swipe | null {
    const g = this.group;
    if (!g) return null;
    const settled = !this.stroke && t - g.lastEnd >= this.o.groupGapMs;
    // ...but don't cut off a movement that's still happening (it may be the real swipe after a wind-up).
    const waitedEnough = !this.stroke && g.firstValidEnd !== null && t - g.firstValidEnd >= this.o.maxWaitMs;
    if (!g.now && !settled && !waitedEnough) return null;
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
      // Bringing a hand back covers about the same ground as the movement out; one that's much faster
      // and longer (e.g. the swipe after a small wind-up) is a real swipe.
      if (s.peak > last.peak * o.returnSpeed && s.travel > last.travel * o.returnSize) return false;
      const since = s.start.t - last.t;
      const fromEnd = Math.hypot(s.start.rx - last.end.rx, s.start.ry - last.end.ry);
      return since < o.returnMs || (since < o.returnNearMs && fromEnd < o.returnNear);
    };
    // Remember real movements (even ones too small to count), never the hand coming back:
    // that would block the next swipe in the same direction as the last one.
    const remember = (s: Stroke, returned = false) => {
      if (s.travel >= Math.min(o.distance, o.distanceVertical) * 0.5 && !isReturn(s)) {
        this.last = { dir: s.dir, t: s.end.t, start: s.start, end: s.end, peak: s.peak, travel: s.travel, returned, slowOnly: s.slowOnly };
      }
    };
    const fire = (s: { dir: SwipeDir; dx: number; dy: number; peak: number; start: Pt; end: Pt }) => {
      this.lockUntil = t + o.cooldownMs;
      this.miss = null;
      return { dir: s.dir, dx: s.dx, dy: s.dy, peak: s.peak, ms: s.end.t - s.start.t, at: s.end.t };
    };
    const cameBack = g.strokes.some(isReturn);

    // A swipe has at most a wind-up before it and a return after it; more back-and-forth is waving.
    let reversals = 0;
    for (let i = 1; i < this.recent.length; i++) if (this.recent[i].dir === OPPOSITE[this.recent[i - 1].dir]) reversals++;
    if (reversals >= o.waveReversals) return this.reject(`waving (${reversals} back-and-forths)`);
    if (this.recent.length >= o.fidgetMoves) return this.reject(`fidgeting (${this.recent.length} moves)`);

    // A slow sweep that the hand then brings back to where it started was deliberate: fire the sweep
    // (never the return). A wind-up is different: the swipe after it carries on past where it started.
    const backTo = (b: Stroke, a: { start: Pt; travel: number }) =>
      Math.hypot(b.end.rx - a.start.rx, b.end.ry - a.start.ry) < a.travel * 0.3;
    const firstValid = g.strokes.findIndex((s) => !s.reason);
    const sweep = g.strokes.find(
      (a, i) =>
        a.slowOnly &&
        (firstValid < 0 || firstValid > i) &&
        !isReturn(a) &&
        g.strokes.slice(i + 1).some((b) => b.dir === OPPOSITE[a.dir] && backTo(b, a)),
    );
    if (sweep) {
      remember(sweep, true);
      return fire(sweep);
    }
    if (last?.slowOnly && !last.returned && g.strokes.some((b) => b.dir === OPPOSITE[last.dir] && backTo(b, last))) {
      // ...and the same when the hand comes back a little later.
      last.returned = true;
      last.slowOnly = false;
      const dx = last.end.rx - last.start.rx;
      const dy = last.end.ry - last.start.ry;
      return fire({ dir: last.dir, dx, dy, peak: last.peak, start: last.start, end: last.end });
    }

    if (!best) {
      remember(top);
      if (cameBack && this.last === last && last) last.returned = true;
      return this.reject(top.reason!);
    }
    if (isReturn(best)) {
      last!.returned = true;
      return this.reject(`${best.dir} ignored: hand coming back from ${last!.dir}`);
    }
    // A quick return in the same burst means the hand has already come back.
    remember(best, g.strokes.some((s) => s.start.t >= best.end.t && s.dir === OPPOSITE[best.dir]));
    this.lockUntil = best.end.t + o.cooldownMs;
    this.miss = null;
    return { dir: best.dir, dx: best.dx, dy: best.dy, peak: best.peak, ms: best.end.t - best.start.t, at: best.end.t };
  }

  private reject(why: string) {
    this.miss = why;
    return null;
  }
}

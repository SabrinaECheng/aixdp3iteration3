"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { DEFAULT_SWIPE, type SwipeDir, type SwipeOptions } from "@/lib/swipe";
import { deriveOptions, score, statsOf, TEACH_PLAN, TEACH_REPEATS, TeachRecorder, type Recording } from "@/lib/swipeTeach";
import styles from "./kiosk.module.css";

export type TeachSink = (t: number, x: number | null, y: number | null) => void;
export type TeachResult = SwipeOptions | "reset" | null;

const ARROWS: Record<SwipeDir, string> = { up: "↑", down: "↓", left: "←", right: "→" };

/**
 * Walks someone through swiping each direction a few times, records exactly how
 * their palm moved, and offers detector settings derived from it.
 */
export default function TeachSwipes({
  sinkRef,
  handVisible,
  hasSaved,
  onClose,
}: {
  sinkRef: RefObject<TeachSink | null>;
  handVisible: boolean;
  hasSaved: boolean;
  onClose: (result: TeachResult) => void;
}) {
  const [step, setStep] = useState(0);
  const [recs, setRecs] = useState<Recording[]>([]);
  const [got, setGot] = useState<string | null>(null);
  const recorder = useRef(new TeachRecorder());

  // Receive every tracking frame from the kiosk while teaching.
  useEffect(() => {
    sinkRef.current = (t, x, y) => {
      const r = recorder.current;
      const ev = r.push(t, x, y);
      if (ev && "got" in ev) setGot(`${ARROWS[ev.got]}  GOT IT`);
      if (ev && "done" in ev) {
        setRecs((all) => [...all, ev.done]);
        setStep(r.step);
        setGot(null);
      }
    };
    return () => {
      sinkRef.current = null;
    };
  }, [sinkRef]);

  const restart = () => {
    recorder.current = new TeachRecorder();
    setRecs([]);
    setStep(0);
    setGot(null);
  };

  const review = useMemo(() => {
    if (step < TEACH_PLAN.length) return null;
    const mine = deriveOptions(recs);
    const odd = statsOf(recs).filter((s) => s.cameOutAs && s.cameOutAs !== s.dir);
    return { mine, before: score(recs, DEFAULT_SWIPE), after: score(recs, mine), odd };
  }, [step, recs]);

  const download = () => {
    if (!review) return;
    const round = (v: number | null) => (v === null ? null : Math.round(v * 10000) / 10000);
    const t0 = recs[0]?.frames[0]?.[0] ?? 0; // times are kept continuous across the whole session
    const data = {
      kind: "stride-one-swipe-recording",
      version: 1,
      recordedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      derivedOptions: review.mine,
      scores: { defaults: review.before, taught: review.after },
      recordings: recs.map((r) => ({
        dir: r.dir,
        frames: r.frames.map(([t, x, y]) => [Math.round(t - t0), round(x), round(y)]),
      })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `swipe-recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (review) {
    const pct = (s: { ok: number; n: number }) => `${s.ok}/${s.n}`;
    return (
      <div className={styles.teach}>
        <div className={styles.teachTitle}>YOUR SWIPES</div>
        <div className={styles.teachSub}>Replaying your {recs.length} swipes (and your hand coming back after each one):</div>
        <table className={styles.teachTable}>
          <thead>
            <tr>
              <th />
              {(["up", "down", "left", "right"] as SwipeDir[]).map((d) => (
                <th key={d}>
                  {ARROWS[d]} {d.toUpperCase()}
                </th>
              ))}
              <th>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["DEFAULT SETTINGS", review.before],
              ["SETTINGS FROM YOUR SWIPES", review.after],
            ].map(([label, s]) => {
              const sc = s as typeof review.before;
              return (
                <tr key={label as string}>
                  <td>{label as string}</td>
                  {(["up", "down", "left", "right"] as SwipeDir[]).map((d) => (
                    <td key={d}>{sc.perDir[d] ? pct(sc.perDir[d]) : "–"}</td>
                  ))}
                  <td>{pct(sc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {review.odd.length > 0 && (
          <div className={styles.teachSub}>
            Heads-up: {review.odd.map((s) => `a ${s.dir} swipe moved mostly ${s.cameOutAs}`).join("; ")}.
          </div>
        )}
        <div className={styles.teachButtons}>
          <button type="button" className={styles.camToggle} onClick={() => onClose(review.mine)}>
            USE MY SWIPES
          </button>
          <button type="button" className={styles.camToggle} onClick={download}>
            DOWNLOAD RECORDING
          </button>
          <button type="button" className={styles.camToggle} onClick={restart}>
            TEACH AGAIN
          </button>
          {hasSaved && (
            <button type="button" className={styles.camToggle} onClick={() => onClose("reset")}>
              BACK TO DEFAULT
            </button>
          )}
          <button type="button" className={styles.camToggle} onClick={() => onClose(null)}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  const dir = TEACH_PLAN[step];
  const n = (step % TEACH_REPEATS) + 1;
  return (
    <div className={styles.teach}>
      <div className={styles.teachEyebrow}>TEACH SWIPES · {step + 1} OF {TEACH_PLAN.length}</div>
      <div key={step} className={styles.teachArrow} data-got={got ? "" : undefined}>
        {ARROWS[dir]}
      </div>
      <div className={styles.teachTitle}>{got ?? `SWIPE ${dir.toUpperCase()}`}</div>
      <div className={styles.teachSub}>
        {!handVisible
          ? "Raise your hand so the camera can see it."
          : got
            ? "Now bring your hand back and let it rest."
            : `Swipe the way you normally would (${n} of ${TEACH_REPEATS}).`}
      </div>
      <div className={styles.teachButtons}>
        <button type="button" className={styles.camToggle} onClick={restart}>
          START OVER
        </button>
        <button type="button" className={styles.camToggle} onClick={() => onClose(null)}>
          CANCEL
        </button>
      </div>
    </div>
  );
}

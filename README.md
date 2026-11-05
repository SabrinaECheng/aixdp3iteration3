# Stride One — touch-free expo kiosk (iteration 3)

Iteration 3 starts from iteration 2 ([kkuang-max/p3iteration2](https://github.com/kkuang-max/p3iteration2)), with its
full history.

A booth kiosk prototype that demos a product while staff are busy. A webcam tracks
the visitor's hand with [Google MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker);
pointing at a part of the exploded shoe opens a short explainer for that part.

## How it works

Two hand modes, switched with the **SWIPE** switch in the top-right corner:

- **Hover (default, switch off):** a pointer follows the visitor's index fingertip. Pointing at a part (or its label)
  pulls just that piece out of the shoe; moving off the shoe puts it back and shows the overview.
- **Swipe (switch on):** no pointer; swipe up for the top (tongue → laces → upper on repeat), down for the sole
  (midsole → outsole), left for the heel, right for the toe. A swiped-open piece stays for 12 s.

| Visitor does | Kiosk does |
| --- | --- |
| Nobody around, or nothing open | The whole shoe slowly rotates back and forth and floats, with an overview of the product |
| Points at / swipes to a part | That piece breaks away from the shoe (attached pieces ride along), glows, and the rest fade back; its info appears bottom-left |
| Keeps their hand near an edge of the camera view | "Raise your hand a little…" (the camera loses hands near the edges) |

The mouse and touch always hover / tap. Bottom-right: `SHOW CAMERA VIEW` and `TURN CAMERA OFF`.
Swipe → part mapping lives in `SWIPE_REGIONS` in `lib/product.ts`.

How swipes are read:

- Each movement is judged as one whole stroke, from when the hand speeds up to when it slows down, so fast flicks,
  slower deliberate swipes and curved swipes all work. A movement is split wherever the hand reverses direction, and
  measured to its furthest point, so a quick flick that springs back still counts in full.
- Many ways of swiping work: quick flicks, normal swipes, slow sweeps, angled and arcing swipes, small swipes. Up /
  down swipes need less travel than left / right ones (people swipe shorter vertically): 0.10 vs 0.13 of the camera
  frame's height.
- A slow sweep counts once the hand comes back to where it started (that's what makes it deliberate rather than the
  hand drifting); the hand coming back never fires on its own.
- A fast swipe that starts from a resting hand fires the moment it's clearly done (as the hand slows down), with no
  waiting. Other movements that follow each other closely (a wind-up the other way, the swipe, a quick return) are
  judged together as one burst, ~0.3 s after the hand calms down and never more than ~0.4 s after the first move. The
  first move wins unless a later one is clearly bigger, so a wind-up never fires instead of the swipe after it.
- Three back-and-forths, or four moves of any kind, within 1.5 s is waving or fidgeting, not a swipe.
- Bringing the hand back after a swipe is ignored (even a couple of seconds later) unless it's much faster *and*
  longer than the movement before it (then it's a real swipe, e.g. after a small wind-up), as are raising a hand into view,
  lowering an arm out of view, slow movement, small jiggles and clearly diagonal moves.
- Start swipes with your hand already in view (around chest height): a swipe that starts below the view doesn't count.

**Keep the hand in the middle of the camera view.** MediaPipe loses a hand that sits near the edge of the view, and
swipes arc downward, so a hand held low drops out of the bottom mid-swipe and the swipe is never seen. If the hand
stays near an edge, the kiosk says so ("Raise your hand a little…"), and teach mode warns when the camera saw the hand
less than 80% of the time. Tracking confidence is set below MediaPipe's defaults so a blurry, fast-moving hand is held
on to rather than dropped.

**Teach swipes (`t`):** walks you through swiping up, down, left and right 5 times each and records exactly how your
hand moves, including how you bring it back. A large live camera view sits beside the prompts with your tracked hand drawn on it and a
dashed box showing where the camera tracks a hand reliably, so you can keep your hand inside it. The review screen replays the recording with the default settings and with
settings derived from your swipes, so you can see which recognises you better:

- `USE MY SWIPES` keeps the derived settings on this machine (browser storage); `BACK TO DEFAULT` undoes it.
- `DOWNLOAD RECORDING` saves the raw recording as a small JSON file, which can be turned into permanent defaults and
  regression tests.
- Very small swipes need loose settings, and loose settings can also be set off by waving; a long wave still opens at
  most one part.

The `d` readout shows `MY SWIPES` when taught settings are active. Logic lives in `lib/swipeTeach.ts`; the screen in
`app/kiosk/TeachSwipes.tsx`.

**Mouse and touch** can't swipe, so they still hover / tap parts or their labels directly.

Prefer the previous point-and-hover hand interaction? It's preserved on the `hover-version` branch.

**Camera view:** the camera always tracks hands, but the video of the visitor is hidden by default so nobody has to
look at themselves. `SHOW CAMERA VIEW` in the bottom-right corner (or `c`) brings up a small preview with the tracked
hand drawn on it, which is handy for staff setting up.

**Camera on/off:** `TURN CAMERA OFF` (or `o`) releases the webcam entirely. Touch and mouse hover/click keep working the
same way, so it still runs on a touchscreen or with no camera. `TURN CAMERA ON` starts tracking again.

Staff keys: arrow keys act as swipes, `t` teaches the kiosk your swipes (swipe mode), `d` shows tracking FPS, how often the hand is found, the last swipe and why the last near-swipe didn't count (for tuning), `c` shows/hides the camera view, `o` turns the camera off/on, `f` toggles fullscreen.

## Code map

- `lib/product.ts` — product name and per-part copy. Swap this to demo another product.
- `lib/shoe.ts` — sliced 3D shoe geometry (ported from the "B · Centre stage" design reference).
- `lib/useHandTracking.ts` — webcam + MediaPipe loop; reports the fingertip and palm each frame; can be switched off.
- `lib/swipe.ts` — turns palm positions into up / down / left / right swipes, one whole stroke at a time.
- `app/kiosk/Kiosk.tsx` — swipes, mouse hover hit-testing, pull-apart animation, attract mode, camera toggles, layout.
- Tuning constants (detail hold time, hover settle time, easing speed, idle timeout…) are at the top of `Kiosk.tsx`.

The hand model ships in `public/models/`, and `npm run dev` / `npm run build` copy the MediaPipe WASM runtime into
`public/mediapipe/`, so the kiosk works without internet once built (expo Wi-Fi is unreliable).
Camera access needs `localhost` or HTTPS.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000 and allow camera access.

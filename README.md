# Stride One — touch-free expo kiosk

A booth kiosk prototype that demos a product while staff are busy. A webcam tracks
the visitor's hand with [Google MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker);
pointing at a part of the exploded shoe opens a short explainer for that part.

## How it works

Visitors **swipe** with an open hand; the direction points at a region of the shoe as it sits on screen.

| Visitor does | Kiosk does |
| --- | --- |
| Nobody around, or nothing open | The whole shoe slowly rotates back and forth and floats, with an overview of the product |
| Raises a hand | Hints around the shoe show ↑ TOP, ↓ SOLE, ← HEEL, TOE → |
| Swipes up | The top opens: tongue, then laces, then upper on each further swipe up |
| Swipes down | The sole opens: midsole, then outsole |
| Swipes left / right | The heel / toe cap breaks away |
| No swipe for 12 s | The piece slides back and the overview returns |

The opened piece breaks away from the shoe (attached pieces ride along), glows, and the rest fade back; its info appears
bottom-left. Swipe → part mapping lives in `SWIPE_REGIONS` in `lib/product.ts`; swipe sensitivity in `lib/swipe.ts`.

How swipes are read:

- Each movement is judged as one whole stroke, from when the hand speeds up to when it slows down, so fast flicks,
  slower deliberate swipes and curved swipes all work. A movement is split wherever the hand reverses direction.
- Movements that follow each other closely (a wind-up the other way, the swipe, a quick return) are judged together as
  one burst, ~0.3 s after the hand calms down. The first move wins unless a later one is clearly bigger, so a wind-up
  never fires instead of the swipe after it. Four or more back-and-forth moves is waving, not a swipe.
- Bringing the hand back after a swipe is ignored (even a couple of seconds later), as are raising a hand into view,
  lowering an arm out of view, slow movement, small jiggles and clearly diagonal moves.
- Start swipes with your hand already in view (around chest height): a swipe that starts below the view doesn't count.

**Teach swipes (`t`):** walks you through swiping up, down, left and right 5 times each and records exactly how your
hand moves, including how you bring it back. The review screen replays the recording with the default settings and with
settings derived from your swipes, so you can see which recognises you better:

- `USE MY SWIPES` keeps the derived settings on this machine (browser storage); `BACK TO DEFAULT` undoes it.
- `DOWNLOAD RECORDING` saves the raw recording as a small JSON file, which can be turned into permanent defaults and
  regression tests.
- Very small swipes need loose settings, and loose settings can also be set off by waving; a long wave still opens at
  most one part.

The `d` readout shows `MY SWIPES` when taught settings are active. Logic lives in `lib/swipeTeach.ts`; the screen in
`app/kiosk/TeachSwipes.tsx`.

**Mouse and touch** can't swipe, so they still hover / tap parts or their labels directly.

**Hand dot:** off by default, so the kiosk just responds to swipes. `SHOW HAND DOT` (or `p`) shows a dot and trail
following the palm. The mouse cursor always shows normally.

Prefer the previous point-and-hover hand interaction? It's preserved on the `hover-version` branch.

**Camera view:** the camera always tracks hands, but the video of the visitor is hidden by default so nobody has to
look at themselves. `SHOW CAMERA VIEW` in the bottom-right corner (or `c`) brings up a small preview with the tracked
hand drawn on it, which is handy for staff setting up.

**Camera on/off:** `TURN CAMERA OFF` (or `o`) releases the webcam entirely. Touch and mouse hover/click keep working the
same way, so it still runs on a touchscreen or with no camera. `TURN CAMERA ON` starts tracking again.

Staff keys: arrow keys act as swipes, `t` teaches the kiosk your swipes, `d` shows tracking FPS, how often the hand is found, the last swipe and why the last near-swipe didn't count (for tuning), `p` shows/hides the hand dot, `c` shows/hides the camera view, `o` turns the camera off/on, `f` toggles fullscreen.

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

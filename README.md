# Playform — touch-free booth kiosk (iteration 3)

Playform is a booth kiosk prototype that supports the people staffing an expo booth. It works like a digital
pamphlet: it answers the general questions about a product so salespeople can spend their time on the in-depth ones,
lets visitors ask for a team member, and collects leads. The demo product is **Orbit Earbuds** (all business details
are bracketed placeholders, e.g. `[BRAND]`, `[X] h`, `[Staff name]`, for the exhibitor to fill in).

Iteration 3 starts from iteration 2 ([kkuang-max/p3iteration2](https://github.com/kkuang-max/p3iteration2)), with its
full history, and is redesigned after user testing (R2 designs). A webcam tracks the visitor's hand with
[Google MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker); touch and a
mouse work too.

## Screens

**Topic hub.** Visitors choose what to learn, in any order, rather than everyone sitting through the same sequence:

| Topic | Answers | The 3D earbud |
| --- | --- | --- |
| 01 What it is | What is this product, and what does it do? | barely apart |
| 02 How it works | How does it work, and what are its main components? | fully exploded; pointing at a part's row lights that part up |
| 03 What's different | What makes it different from competing products? | the parts behind the differentiators light up |
| 04 Where it's used | What are its main applications or use cases? | barely apart |
| 05 Specs | Key specifications and compatibility | battery lit up |

**Talk to our team** (top right). Tells staff a visitor is waiting. The visitor sees who is coming and roughly when;
the staff tablet (shown beside it in this prototype; its buttons work with a mouse/touch) shows what the visitor
explored, which topic they spent longest on, time at the kiosk and whether they want pricing, so the conversation can
skip the basics. `PASS TO TEAMMATE` swaps who is coming.

**Get the brochure** (bottom right). Badge scan (fastest; simulated in this prototype), a QR code for the visitor's
phone, or typing an email (+ optional company). It lists the topics they looked at and has a pricing follow-up
checkbox (on by default). Leads are saved in this browser's storage (`playform.leads`) for the prototype; a real
booth would send them to its CRM.

**Nobody around:** the hub flips through the topics every 5 s like a pamphlet on a stand to draw people in. After 45 s
with nobody around (3 min on the "team member is coming" screen), the visitor's session is cleared and the kiosk
starts over. Staff can press `r` to start fresh straight away.

## Hand interaction

Two hand modes, switched with the **SWIPE** switch in the top-right controls:

- **Point and hold (default, switch off):** a pointer follows the visitor's index fingertip. Holding it over a topic
  opens it after 0.9 s (the ring around the topic number fills); holding over a button presses it after 1.2 s (a bar
  fills under it, and the pointer's ring fills too). The mouse opens topics by resting on them as well, and clicks
  everything else. Touch taps.
- **Swipe (switch on):** no pointer. Swipe left (or down) for the next topic, right (or up) for the previous one, like
  turning pages. On the team and brochure screens, swipe right to go back to exploring.

If the hand stays near an edge of the camera view, the kiosk says so ("Raise your hand a little…"), because the camera
loses hands near the edges.

## How swipes are read

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
- Very small swipes need loose settings, and loose settings can also be set off by waving; a long wave still turns at
  most one page.

Logic lives in `lib/swipeTeach.ts`; the screen in
`app/kiosk/TeachSwipes.tsx`.

Controls (top right): tracking status, the SWIPE switch, `CAMERA VIEW` (a small preview with the tracked hand drawn
on it; the camera always tracks hands, but nobody has to look at themselves by default) and `CAMERA OFF` (releases the
webcam entirely; touch and mouse keep working).

Staff keys: arrow keys act as swipes, `t` teaches the kiosk your swipes (swipe mode), `d` shows tracking FPS, how
often the hand is found and the last swipe, `c` shows/hides the camera view, `o` turns the camera off/on, `r` starts
fresh for the next visitor, `f` toggles fullscreen.

## Code map

- `lib/product.ts` — product name, the five topics and their copy, the earbud's parts, staff placeholders. Swap this to
  demo another product.
- `lib/model3d.ts` — turns 2D part outlines into a sliced 3D model that can come apart and highlight parts.
- `lib/session.ts` — what the current visitor explored and for how long, pricing interest, contact details; lead storage.
- `lib/useHandTracking.ts` — webcam + MediaPipe loop; reports the fingertip and palm each frame; can be switched off.
- `lib/swipe.ts` / `lib/swipeTeach.ts` — swipe detection and teach mode.
- `app/kiosk/Kiosk.tsx` — screens, pointing and hold-to-press, swipes, attract loop, session reset, camera controls.
  Timing constants are at the top.
- `app/kiosk/Screens.tsx` — the hub, team and brochure screens. `Model3D.tsx` renders the earbud.

The hand model ships in `public/models/`, and `npm run dev` / `npm run build` copy the MediaPipe WASM runtime into
`public/mediapipe/`, so the kiosk works without internet once built (expo Wi-Fi is unreliable).
Camera access needs `localhost` or HTTPS.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000 and allow camera access.

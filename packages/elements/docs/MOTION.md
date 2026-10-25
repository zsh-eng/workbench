# Motion

How sheets and feedback move in Reader and Arctic for the web, and the
measurements behind the springs in `src/spring.ts`.

A spring here is a **response** (seconds for one undamped swing, UIKit's
`perceptualDuration`) and a **damping ratio** (1 settles without overshoot).
In stiffness terms, with mass 1: `stiffness = (2π / response)²` and
`damping = 2 · ratio · √stiffness`.

## Native iOS sheets

Measured on the iOS 27 simulator (iPhone 17e, 390 × 844 pt) with a small
UIKit app: `UISheetPresentationController` sheets presented, changed with
`animateChanges` and dismissed, the sheet's top edge read from its
presentation layer on every display-link frame, and the Core Animation
animations UIKit installs read back.

**What UIKit installs.** Presenting and dismissing add a `CASpringAnimation`
of mass 3, stiffness 1000, damping 500 with overdamping off, so it runs
critically damped at ω = √(1000 / 3) = 18.26 rad/s: response 0.344 s,
duration 0.5 s. A detent change adds mass 1, stiffness 333.33, damping
36.515: the same ω and damping ratio 1, duration 0.506 s. One spring for
everything.

**Fitted to the frames** (damped spring, start offset free):

| Move                     | Distance | Response      | Damping   | First frame | Still (0.5 pt) |
| ------------------------ | -------- | ------------- | --------- | ----------- | -------------- |
| Open at a 200 pt detent  | 232 pt   | 0.342–0.344 s | 1.00      | +14 ms      | 445–456 ms     |
| Open at a third          | 281 pt   | 0.341–0.342 s | 1.00      | +21–28 ms   | 460–470 ms     |
| Open at medium           | 450 pt   | 0.344 s       | 1.00      | +21–41 ms   | 490–495 ms     |
| Open at large            | 798 pt   | 0.344–0.345 s | 1.00      | +19–20 ms   | 492–493 ms     |
| Third to medium          | 168 pt   | 0.342–0.343 s | 1.00      | +8 ms       | 432 ms         |
| Medium to large and back | 347 pt   | 0.334–0.354 s | 0.98–1.01 | +7–26 ms    | 466–529 ms     |
| Close from medium        | 450 pt   | 0.341–0.344 s | 1.00      | +10 ms      | 497–498 ms     |
| Close from large         | 796 pt   | 0.345–0.348 s | 0.99–1.00 | +12 ms      | 498 ms         |

Residuals are about 0.1 pt. Medium rests at 393.6 pt, large at 47 pt.

- **Settle time hardly depends on distance.** It grows with the logarithm of
  the distance: 432 ms for 168 pt, 498 ms for 798 pt. The model says 537 ms
  for the longest moves; UIKit cuts the animation at 0.5 s, by when the
  sheet is under a point from rest.
- **Latency is one or two frames.** The first moving frame comes 5–41 ms
  after the call.
- **Closing** uses the same spring and stops just below the screen.

**Released by a finger** (XCUITest drags and flicks):

- A slow release (up to about 600 pt/s here) settles critically: response
  0.335–0.345 s, ratio 1.0. A 130 pt drag up from medium returns to medium.
- A thrown release keeps the finger's speed and has give: response
  0.35–0.37 s, ratio about 0.80, overshooting the detent by 4–7 pt.
- A flick down past medium dismisses on that thrown spring (response
  0.345 s, ratio 0.80) to about 11 pt below the screen, gone from view about
  0.2 s after release.
- At large the top edge does not rubber-band upward. A drag has about 25 pt
  of slop before the sheet follows.

## Telegram for iOS

From the source (`TelegramUI` and `Display`, revision `fb0e62ba`):

- **iOS 26 `.spring`**: mass 1, stiffness 555.027, damping 47.118, critical,
  response 0.267 s, still at 0.383 s. Older systems use mass 3, stiffness
  1000, damping 500 for 0.5 s, the curve UIKit sheets use (measured critical,
  response 0.34 s). `.spring` at another duration is
  `cubic-bezier(0.38, 0.7, 0.125, 1)`.
- **SheetComponent**: in with UIKit's curve 7 over 0.4 s, dimming 0.3 s; out
  programmatically over 0.25 s ease-in-out; a flick out on mass 5, stiffness
  900, damping 124 scaled to 0.35 s (response about 0.25 s, ratio 0.93).
- **AttachmentContainer** detent switch: the same spring scaled to 0.45 s
  (response 0.32 s, ratio 0.92), with thresholds of 300 pt/s, 60 and 180 pt,
  and 1800 pt/s.
- **NavigationModalContainer**: dismisses past 500 pt/s or half the height,
  over `min(0.3, 0.4 / |v in pt/ms|)` s ease-in-out; snaps back on a 0.5 s
  spring; programmatic in and out over 0.25 s.
- **ResizableSheet**: dismisses past `min(180 pt, 25%)` or 1000 pt/s, appears
  on a 0.5 s spring. Dragging up at the top is clamped.

## The web sheets

React Aria's `Sheet` is a 200 dvh scroll container that snaps to its
detents. Opening, closing and changing detent are smooth scrolls, and the
dimming, the lower sheet's step back and the close on leaving the view all
follow the scroll offset.

**Before**, in iOS Safari (simulator, the same script as the native app):
smooth scrolls started 45–227 ms after the call, ran for 134–258 ms on
WebKit's curve, accelerating, and stopped hard at about 600 px/s. It is not
a spring (residuals of 6–20 pt against the best one).

**Now** `springSheetScroller` (`src/sheet-motion.ts`) takes over the
scroller's smooth scrolls and runs `SPRINGS.sheet` on `scrollTop` frame by
frame:

- Snapping is off while the spring runs and comes back after it.
- The spring covers only the visible travel. An entering sheet starts at
  the bottom of the screen (100 lvh, so under Safari's toolbar too), and a
  leaving one stops there and drops to its closed place out of view.
- The target is the nearest snap position, as the browser's own smooth
  scroll does. In iOS Safari the range runs past full height.
- The browser's own `scrollend` events are held back while the spring runs,
  and one is sent when it ends, since React Aria waits for it.
- A finger or a wheel stops the spring where it is and the browser's
  scrolling carries on; a tap does not. A new move starts from the current
  place and speed.
- With reduced motion React Aria scrolls instantly and nothing runs.

Measured in iOS Safari the same way: opening to the menu, opening to medium,
to full height and back fit response 0.342–0.346 s and ratio 1.00 (residuals
0.5–2 pt), still after 453–486 ms, first frame +18–80 ms. Telegram's spring
(`SPRINGS.snappy`) fits 0.266–0.279 s.

**Why scroll, not transforms.** Animating the sheet with a transform (FLIP
on the compositor) would run at 120 Hz on ProMotion, but React Aria's
dimming, the step back and its close-on-leave read the scroll position, so
they would fall out of step and the sheet would close early. Driving the
scroll keeps them together and keeps the drag native. The cost: the spring
runs on the main thread at Safari's requestAnimationFrame rate (60 Hz), and
a busy main thread drops frames.

**Still open.**

- In a Safari tab, React Aria unmounts a closing sheet once it is out of
  `innerHeight`, about 250 ms into the close, so the last of the close is
  cut. A home-screen app is not affected.
- A thrown sheet settles with the browser's snap, not UIKit's 0.8-ratio
  release spring.
- 60 Hz on a 120 Hz phone.

## Feedback

- **Copy**: the copy glyph shrinks away and a check draws itself, short
  stroke first (`pathLength`, `SPRINGS.snappy`).
- **Saved to notebook**: on phones the saved words fly from the field into
  the notice's mark along a short arc (two springs, across and down), shrink
  to a dot of the highlight colour, and the mark pops and draws its check.
  The copy that flies is hidden from assistive technology; the notice is a
  status.
- **Note deleted**: the note dissolves into the notice (blur, fade, a little
  scale) and Undo counts down. Undo brings back a **Note restored** notice.
- **Toasts** open out of a pill at their centre on `SPRINGS.pop`
  (`--wb-spring-pop` in `toast.css`), their words fading in once there is
  room, and fold back as they leave.
- The island's shape changes on `SPRINGS.morph` (ratio 0.8, 1.5% overshoot).
- With reduced motion, everything cross-fades: no flight, no shape change.

Prototypes of the alternatives are in Design ideas → Feedback (the notes
bubble that swells and counts on; a pill grown out of the tapped button) and
Design ideas → Sheet motion (smooth scroll, UIKit's spring, Telegram's).

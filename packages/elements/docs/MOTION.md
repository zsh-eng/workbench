# Motion

How sheets and feedback move in Reader and Arctic for the web, and the
measurements behind the springs in `src/spring.ts`.

## Motion principles

Motion is for connecting things. Each movement answers one question: where
did this come from, where did it go, which way are we going, or is this
still the same thing? A movement that answers none of them is left out.

**1. Connect, or stay still.**

- Do: the page slides the way you turn it. A sheet rises from the edge it
  goes back to. A saved note's words fly into the notice that confirms them.
  The spill tab unrolls from the cut in the selection.
- Don't: fade a list out and in after a sort, float a decoration on a loop,
  or nudge a button that did not change.

**2. One subject, one element.** A toast, notice or button keeps its
element for its whole life. A change to it changes its content in place.

- Do: delete, and "Highlight deleted · Undo" appears. Tap Undo, and the
  same toast draws a check, says "Restored" and leaves. Delete three
  highlights in a row and one toast says "3 highlights deleted". Each
  deletion that joins it starts the countdown again, and its Undo brings
  back all three. The keyboard's Undo takes back one at a time, and the toast
  counts down what is left.
- Don't: dismiss the Undo toast and show a new "Restored" toast, or stack a
  toast per deletion. A second "Link copied" is the same toast staying, not
  a new one arriving.
- In code: `Toast` takes `undo.round` and `done`. In Reader,
  `showUndoToast` returns `update` and `done`, which re-render the same
  sonner id. In Arctic, `showToast(message, action, { key })` keeps the
  element for the same key.

**3. Icons morph, cross-fade or swap.**

- Morph when a control changes state because you used it, and the two
  shapes belong together. Copy becomes a check that draws itself, and the
  Undo countdown's ring becomes a check. A play/pause toggle would morph too.
  This is SF Symbols' replace transition.
- Cross-fade (150 ms, no movement) when the meaning changes in the same
  place while you watch, such as a status icon on a control you're looking at.
- Swap at once when the context changed the control and you didn't. The
  composer shows Send for a new note and a check for an edit. The swipe
  action shows Edit or Delete by direction. Jot becomes Draft while the
  composer closes over it.
- Never: morph shapes that have nothing in common, spin an icon to celebrate,
  or loop an icon. A spinner while waiting is the one exception.

**4. Floating buttons** (the notes bubble, the Notebook entry, the spill
tab, the history pill, the island):

- Arrive with their parent. The notes bubble is docked on the footer and
  slides with it, without an entrance of its own. The history pill belongs
  to the footer's strip and grows in place there.
- Change in place. A count or a label changes without the button moving.
- Become what they open. A toast opens out of a pill, the island changes
  shape for each layer, and the spill tab unrolls from the cut. One floating
  surface per place: while the island is open, the bubble steps aside.
- Leave the way they came, faster: surfaces enter in 0.18 s and leave in
  0.14 s.

**5. Restraint.**

- Durations: feedback takes 150–250 ms and surfaces 0.14–0.18 s. Shape
  changes and sheets run on springs that rest in 0.3–0.5 s. Nothing takes
  longer, except the countdown, which is a clock.
- Never animate: page text while you read (chrome never moves it), a scroll
  you didn't ask for, a layout change that a count causes, anything on load
  that you didn't cause, or a loop that isn't a wait.
- Interruptible: a new action starts from where things are. A spring takes
  the current position and speed, and a toast takes the new words. Nothing
  waits for an animation to finish before taking a tap.
- Reduced motion: no movement, no change of shape, no drawing. Things
  cross-fade, and state changes happen at once.

**6. References.** On iOS: SF Symbols' replace transitions, and the Dynamic
Island, one surface that changes shape and content for each activity and
never stacks. In Telegram: the undo bar, which counts down and changes in
place, and the message ticks, which change from one to two in place.

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

## iPad

**What Apple says.** In regular width and height, an iPad app's sheet is a
page or form sheet, centred over a dimmed page; detents are "designed for
iPhone".

- [HIG: Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets):
  prefer the page or form sheet styles on iPad; each centres its content
  over a dimmed background. People expect to swipe a sheet down to dismiss
  it. Medium is about half of the fully expanded height.
- [`formSheet`](https://developer.apple.com/documentation/uikit/uimodalpresentationstyle/formsheet):
  centred in regular width and height, smaller than a page sheet, sized by
  `preferredContentSize`, with part of the page always in view. In compact
  width it is a phone's sheet; in compact height, full screen.
- [`pageSheet`](https://developer.apple.com/documentation/uikit/uimodalpresentationstyle/pagesheet):
  roughly a page, taller than wide, centred over a dimming layer; the same
  fallbacks.
- [`prefersPageSizing`](https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/prefersPageSizing)
  (iOS 17): a sheet follows the readable width (page) by default, or
  `preferredContentSize` (form).
- SwiftUI's [`presentationSizing`](https://developer.apple.com/documentation/swiftui/presentationsizing):
  [`.automatic`](https://developer.apple.com/documentation/swiftui/presentationsizing/automatic)
  resolves to [`.form`](https://developer.apple.com/documentation/swiftui/presentationsizing/form),
  "slightly less wide than `.page`", on iOS and iPadOS.
- [`medium()`](<https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/detent/medium()>)
  is about half the screen and inactive in compact height;
  [`largestUndimmedDetentIdentifier`](https://developer.apple.com/documentation/uikit/uisheetpresentationcontroller/largestundimmeddetentidentifier)
  is `nil` by default, so every detent dims.
- [WWDC21 "Customize and resize sheets in UIKit"](https://developer.apple.com/videos/play/wwdc2021/10063/):
  on iPad a popover that adapts to a sheet in compact width is often wanted
  instead of a sheet with detents. Reader (from 768 px) and Arctic (above
  720 px) already do this: their tools are a sidebar, popovers and menus.

**What it does.** Measured on the iPadOS 27 simulator, iPad Air 11-inch
(820 × 1180 pt) and iPad Pro 13-inch (1032 × 1376 pt), portrait, with the
probe app:

| Sheet               | 820 pt wide                               | 1032 pt wide             |
| ------------------- | ----------------------------------------- | ------------------------ |
| Form sheet          | 580 × 660, centred, every corner round    | the same                 |
| Page sheet          | full width, top 32 pt down                | 928 wide, floating       |
| Form sheet, detents | 580 wide on the bottom edge, lifted 20 pt | the same                 |
| Page sheet, detents | full width, 8 pt from the edges           | page width, lifted 20 pt |

The page under every one is dimmed, about 20%. A form sheet with a field
in focus moves to the centre of the space above the keyboard; a sheet with
detents goes to large.

**What the web sheets do.** On a touch screen at least 640 × 600
(`SHEET_FORM_QUERY`, `sheetPlacement` in `src/sheet-body.tsx`):

- A sheet without detents is a form sheet: centred, 580 px wide at most,
  every corner round, over the dimmed page. It stays centred above the
  keyboard (React Aria's `--sheet-scroll-padding-y`).
- A sheet with detents stays on the bottom edge at 580 px, lifted 20 px,
  floating at every height; at full height its top is 32 px down. It keeps
  its detents, so the page above stays in view.
- Every sheet leaves by a swipe down, as on a phone.
- A phone in either orientation, a window narrower than 640 px beside
  another app, and a desktop without touch keep the phone sheet. The layout
  follows the window as it turns or is resized, and an open sheet keeps its
  detent or full view (`holdRestOnResize`): WebKit otherwise snaps it to
  whichever is nearest its old offset.

`sheet-ipad.spec.ts` (Reader, WebKit with touch) covers 820 × 1180,
1180 × 820, 1024 × 1366, 1366 × 1024, a phone, a desktop, turning, and
widths of 500 and 678 px; Arctic's `ipad.spec.ts` its own sheets.

**Not confirmed.**

- The 640 px line. A page cannot read UIKit's size classes, and
  [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
  no longer lists them per device or Split View width: it says the system
  sets them by device, window and multitasking, and to lay out by them, not
  by device or orientation. The simulator would not turn or split here, so
  landscape, Split View and Stage Manager widths were not measured. 640
  keeps every phone (up to 440 pt wide) and a third of an iPad below it,
  and half of a 13-inch iPad in landscape (678 pt) above it.
- The dimming on the web stays the app's own; only its strength was read
  from the simulator.
- A real iPad: the tests run Playwright's WebKit with touch, which replays
  no touch drag (a trackpad's scroll stands in for the swipe) and reports
  no touch points (the tests report five, as iPadOS Safari does).

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
  the bottom of the screen (100 lvh, so under Safari's toolbar too). A
  leaving one stops a pixel past it, where React Aria's
  IntersectionObserver sees none of it, and snapping stays off until React
  Aria closes it; snapping back on would pull it up to its detent.
- The target is the nearest snap position, as the browser's own smooth
  scroll does. In iOS Safari the range runs past full height. The spring
  heads for the snap marker, so a detent that moves during the move (the
  sheet's height changed) still gets the sheet.
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

## Sheet behaviour

The rules every sheet in Reader and Arctic follows, taken from UIKit. The
shared sheet carries them (`src/sheet-fit.ts`, `src/sheet.css`), so a
screen gets them by being in it. Debug tools → Sheet Lab shows each one.

### What UIKit does

Measured on the iOS 27 simulator (iPhone 17e, 390 × 844 pt, display corner
47.33 pt) with `UISheetPresentationController`, frames read from the
presentation layer.

**Shape.**

| Where the sheet is   | Inset (sides, bottom) | Top corners | Bottom corners       |
| -------------------- | --------------------- | ----------- | -------------------- |
| A partial detent     | 8 pt                  | 38 pt       | 39.33 pt (47.33 − 8) |
| Between it and large | 8 → 0 pt, linear      | 38 pt       | 47.33 − inset        |
| Large (top at 47 pt) | 0                     | 38 pt       | square, at rest      |
| Landscape, compact   | 0 (covers the screen) | –           | –                    |

- The bottom corners stay concentric with the display's. The surface is a
  continuous curve with no shadow; the page dims 20% black at every detent
  and does not scale back.
- In a programmed move the inset follows the sheet's position, on the same
  spring. Opening, the inset grows from 0 to 8 pt with the sheet; the web
  keeps 8 pt.
- **A sheet over a sheet.** Upper at medium: the lower sheet gets 12% more
  dimming and the upper rests about 5.4 pt lower. Upper at large: the lower
  sheet scales to 0.92 and moves up 32.7 pt; the upper's top is at 57 pt.

**Height.**

- A **fixed detent** (medium, large, a constant) never moves when the
  content changes. Rows that animate in or out do so inside the sheet; the
  table view absorbs the change and scrolls.
- A **fitting detent** (a resolver that reads the content's height) moves
  only when the app calls `invalidateDetents()`, once per call, on the
  detent spring (response 0.344 s, critical) inside `animateChanges`.
  Without the call the sheet stays where it is, however the content grows.
- `UITableView` inserts and deletes rows on response 0.30 s, critical,
  0.44 s. A pinned bottom bar stays on the sheet's bottom edge while the
  sheet resizes.
- **The keyboard.** A field at medium raises the sheet to large on the
  keyboard's curve (response 0.267 s, critical, `SPRINGS.snappy`). The
  selected detent stays medium, and the sheet returns there when the
  keyboard goes.

### The rules

1. **A sheet changes height for a reason, once.** The person moves it, the
   app asks (a tab, a page, a detent), or the content has settled. It never
   follows the frames of a content animation.
2. **Fixed detents hold.** At a partial detent the sheet runs on below
   the screen, and only that part changes: its height changes at once and
   it re-snaps in the same frame, so its top edge holds. A spring there
   would shift it by a fraction of a pixel each frame, since scroll offsets
   are whole pixels. Only a sheet that becomes shorter than its detent
   moves its top edge, on the spring. A sheet shorter than its detent rests
   at both the detent and full view, and keeps the one it was at, as UIKit
   keeps the selected detent: content that grows again takes it back there.
3. **A sheet that fits its content** (`fit`) follows it by kind of change:
   - A change within one frame (a tab, a filter) moves the sheet at once on
     `SPRINGS.sheet`.
   - Growth over several frames is followed on `SPRINGS.sheet`. The
     content runs on below the bottom edge meanwhile, and a footer
     (`[data-sheet-footer]`, a field or a toolbar) stays on that edge.
   - Shrinking over several frames (rows that collapse) is held. The freed
     space shows at `[data-sheet-slack]`, where the screen puts it: in the
     Notebook, below the list and above the field. Once the content has
     been still for 250 ms, the sheet settles once.
4. **Nothing resizes under a finger.** A touch, a mouse button, or a scroll
   the person started less than 120 ms ago holds every height change until
   it ends.
5. **Content animates in place.** Rows collapse and expand on their own
   curve inside the sheet. A height change never scrolls the content.
6. **Scroll or move.** At a partial detent a swipe moves the sheet; the
   content scrolls only at full height.
7. **The keyboard.** A field at a partial detent raises the sheet to full
   height on `SPRINGS.snappy`; when the field lets go the sheet returns to
   the detent nearest where it was, never the closed place, on the same
   spring. Dragged below full height, the sheet puts the keyboard away.
8. **Shape follows position.** Below its highest partial detent a sheet
   floats with the measured inset and corners. Between that detent and
   full view the inset and the bottom corners follow the scroll position
   (a scroll-driven animation, so a drag keeps them in step). A sheet
   shorter than its maximum height floats in full view too. On a phone in
   landscape, sheets meet the edges.
9. **Reduced motion** makes every move instant, after the same waits, so
   the content still does not jump twice.

**Markup.** A fitting sheet renders `[data-sheet-fit]` (its height) around
`[data-sheet-fit-content]`. The fit box has `data-sheet-fit-state`: `rest`,
`held` or `settling`; tests wait for `rest`. The overlay has
`data-sheet-shape`: `float`, `attach` or `attached`. The sheet's own box
keeps one width, so its content never reflows while the shape changes: the
surface behind it (`::before`) widens, and a mask on the scroller lifts and
rounds the bottom edge. A mask, not a clip-path: React Aria reads full view
from an IntersectionObserver, which applies an ancestor's clip-path.

**Why the Notebook jumped.** Its full position is a fitting detent, and its
height was the content's in every frame. Each swiped row collapsed on a
height tween, and the sheet's top edge followed every frame of it, three or
four times in a row; Undo grew it back in a frame or two. Main-thread
stalls of 60–100 ms in development builds (the whole list renders again on
each delete) dropped frames in the middle. Now the sheet holds while the
rows collapse and settles once.

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

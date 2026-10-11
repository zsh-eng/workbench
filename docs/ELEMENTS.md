# Elements pages and demos

Each product has one **Elements** page. It shows the product's parts on sample
data, in every theme and at each device size. Each state is one click away.
Use it to review and tune design work. A TODO or a pull request links to the
Elements section that shows the change.

This guide gives the shape that all Elements pages share. It also gives the
contract for demos that play, reset, or scrub. Med's page is the reference for
inline specimens. Reader's page is the reference for device frames.

| Product | Where                                                                  | Code                                    |
| ------- | ---------------------------------------------------------------------- | --------------------------------------- |
| Med     | `/elements`                                                            | `apps/med/src/web/components/elements/` |
| Reader  | `/debug/elements` (Debug mode on)                                      | `apps/reader/src/features/elements/`    |
| Spaced  | `/debug/elements`                                                      | `apps/spaced2/src/elements/`            |
| Arctic  | Sort and filter → Elements, or launch with `-ArcticElements <section>` | `apps/arctic/Sources/Elements/`         |

Med runs only on the local machine, so its page is at `/elements`. Deployed
apps keep the page behind their debug route. The page is a lazy chunk, so it
does not add to the first load.

## Page anatomy

1. **Bar.** A back link, the title "Elements", and the stage controls:
   - **Theme.** It previews a theme on the page or in the frames only. The
     saved setting does not change. Med adds "Use in Med" to keep a theme.
   - **Zoom.** Inline pages step 1×, 2×, 3×. Frame pages choose Fit or 100%.
   - Optional inspection tools, for example Med's "Outline boxes" and
     "Inspect tokens".
2. **Section navigation.** A sticky list of sections. It follows the scroll
   (`useActiveSection`). On a phone, it becomes a menu at the top.
3. **Sections**, in this order:
   1. **Foundations**: colour tokens, the type scale, radii, and motion
      durations. Every colour on the page comes from these tokens.
   2. Parts, from small to large: controls, components, overlays and sheets,
      then screens.
   3. **Live app** last: the real app in frames. Say that it uses this
      origin's data.
4. **Specimens.** Each specimen has a caption (a title and one note) and a
   stage. A specimen can also have a state picker and demo controls.

## Specimens

A specimen shows one part or a small group. It uses one of two stages:

- **Inline.** The part renders on the page. A surface switch shows it on each
  background, for example Med's canvas, panel, and raised. Use inline stages
  for controls and components that do not depend on the viewport.
- **Device.** The part renders in a same-origin iframe at Desktop 1280×800
  and Phone 390×844 (`DEVICES` in `@workbench/elements/frames`). Media queries
  and touch layout see the device width. Use device stages for sheets,
  navigation, and screens. Each frame has Reload and "Open in a new tab".

Rules:

- **States.** Give a specimen a row of named states, not one sample. When you
  choose the current state again, it replays. Frames get the state through
  `?state=` and the `elements:state` message (`FrameMessage`), so a change
  does not reload the frame.
- **Real components.** Render the production component. Do not copy it into
  the page. If a part needs app context, give it a small sample provider.
- **Sample data.** Keep fixtures beside the section, in `*-fixture.ts` files.
  Do not show production data in a specimen. A live-app row must say that it
  shows this origin's data.
- **Compare.** When a design changes, show the current and the proposed
  version side by side, with the same data. Keep the proposal on the page
  until the user chooses.
- **Captions.** The title names the part as the user knows it. The note says
  what to try, for example "Drag the handle up to the second detent".

## Demos: play, replay, reset, and scrub

Use `@workbench/elements` for each specimen that moves. The package is
headless. It owns time and behaviour; each app draws the controls in its own
style.

```ts
import { useDemoPlayer } from "@workbench/elements/react";

const demo = useDemoPlayer({ duration: 1.2, beats: [{ at: 0.4, label: "Lift" }] });
<div ref={demo.stageRef} {...demo.stageProps()}>…</div>
<button {...demo.playButtonProps()} />
<div {...demo.scrubberProps("Sheet timeline")} />
```

There are two kinds of demo:

| Kind     | When                                                         | Controls                                    |
| -------- | ------------------------------------------------------------ | ------------------------------------------- |
| Timeline | The view is a function of time, or real animations to scrub. | Play/Pause, Replay at the end, Scrub, Speed |
| Run      | A live component that plays by itself or waits for input.    | Replay (plays by itself) or Reset (waits)   |

- **Timeline.** Give `duration` in seconds and optional `beats`. Draw from
  `state.time`. To scrub real CSS, Web Animations, or Motion animations, call
  `driveAnimations(player, () => root.getAnimations({ subtree: true }))`.
- **Run.** Omit `duration`. Use `state.run` as the component's `key`, so each
  restart mounts it again. The med-site windows and Reader's toasts are runs.

Shared behaviour:

- **Start.** A demo starts when most of its stage is in view (60% of the
  stage, or 60% of the view for a tall stage). It pauses when the stage
  leaves the view. After the viewer uses a control, only the viewer starts
  and stops it.
- **Reduced motion.** A demo does not start by itself. It shows its last
  moment. The controls still work.
- **Keys** on a focused stage or scrubber: Space plays or pauses. Left and
  Right step. Shift with Left or Right moves between beats. Home and End go
  to the ends. R restarts.
- **Deep links.** `?t=2.4` opens a timeline at 2.4 s, paused. `?autoplay=0`
  waits for Play. `#section` scrolls to a section. These match the blog's
  figures (`?scene=…&t=…`).
- **Speed.** Offer 0.25× and 1× on timelines that tune motion, so a viewer
  can study a curve.

The blog's figures (`~/blog/posts/*/assets/*.html`) follow this contract with
their own inline player, because each figure is one self-contained file. The
marketing site's Replay and Reset buttons are runs.

## Native apps

Arctic follows the same shape in SwiftUI:

- An **Elements** screen opens from Sort and filter → Elements. The launch
  argument `-ArcticElements <section>` opens it at a section for screenshots
  and recordings.
- A `List` of sections, with Foundations first. Each specimen has a caption
  and a stage. A segmented state picker replays its state when you choose it
  again.
- `DemoPlayer`, an `@Observable` type, has the same contract as the web
  player: time, beats, play, pause, scrub, restart, start in view, and
  Reduce Motion.
- Specimens render the production views with fixtures. They never read or
  write the user's library.

## Recordings

A TODO can link to a recording as well as a section. Recordings are local
files; do not commit them.

- Web: open the section with `?autoplay=0`, then record with Playwright
  (`recordVideo`) or the browser pane.
- iOS: `xcrun simctl io booted recordVideo <file>.mp4` while the specimen
  plays. A simulator recording does not show device frame rate.

## Checklist for a new section

1. Add the section to the page's section list, with Foundations first.
2. Render production components with fixtures and a state picker.
3. Give each moving specimen demo controls from `@workbench/elements`.
4. Check every theme, both devices, keyboard use, and reduced motion.
5. Add or update an end-to-end test that opens the section and changes a
   state.

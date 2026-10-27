# @workbench/elements

Headless parts for Elements pages and demos. See
[Elements pages and demos](../../docs/ELEMENTS.md) for the page shape and the
demo contract.

- `@workbench/elements`: `createDemoPlayer`, `driveAnimations`,
  `handleDemoKey`, `demoOptionsFromUrl`. No framework.
- `@workbench/elements/react`: `useDemoPlayer` with prop getters for the
  stage, Play, Replay or Reset, and the scrubber; `useActiveSection`.
- `@workbench/elements/frames`: `DEVICES`, `FrameMessage`, `FrameTimeMessage`,
  `FrameReadyMessage`, `isFrameReady`, `useDeviceRowScale`, `useNearView`,
  `useFrameSelection`, `useFrameTime`.
- `@workbench/elements/toast`: `Toast` and `UndoCountdown`, a toast that
  offers Undo with a ring and a number counting down, after Telegram's undo
  bar. Import `@workbench/elements/toast.css` once and colour it with its
  `--wb-toast-*` properties; the app places it and moves it in and out. Arctic
  for the web and Reader use it.
- `@workbench/elements/spring`: `SPRINGS`, the springs the apps share
  (UIKit's sheet, Telegram's, a release, a pop, a morph), and
  `springDisplacement`, `settleTime`, `springCurve` (a CSS `linear()`
  easing) and `springTransition` (for `motion`).
- `@workbench/elements/sheet-motion`: `springSheetScroller`, which moves a
  React Aria `Sheet` on a spring instead of a smooth scroll, `springSheetTo`
  (one move on another spring, as the keyboard's), `holdRestOnResize`
  (a resting sheet keeps its detent when the window turns), and
  `sheetSnaps` and `snapPosition`, where a sheet can rest.
- `@workbench/elements/sheet-fit`: `fitSheetHeight`, which keeps a sheet's
  height in step with its content without chasing the content's own
  animations, and `trackSheetShape`, which tells `sheet.css` where the sheet
  floats and where it meets the screen's edges. Import
  `@workbench/elements/sheet.css` once and colour the surface with its
  `--wb-sheet-*` properties.
- `@workbench/elements/sheet-body`: `useSheetBody`, the behaviour of a React
  Aria sheet's body (its spring and shape, the scroll out on close, and the
  keyboard kept clear of its detents), `SheetFitHeight`, which holds the
  height for the content, `isTextField`, and `useSheetForm` and
  `sheetPlacement`, which give a sheet an iPad's form layout on a wide
  touch screen.

Arctic for the web and Reader use the sheet parts. See
[docs/MOTION.md](docs/MOTION.md) for the measurements behind them and the
rules they follow ("Sheet behaviour", "iPad").

The package exports TypeScript source. It works with React 18 and 19; the
toast needs 19. The toast uses no hooks, so an app whose React is another copy
can render it.

## In a self-contained page

The player has no imports, so a page outside the workspace, such as a blog
figure, can carry its own copy (about 3 KB):

```sh
bun build packages/elements/src/player.ts --format esm --minify --outfile assets/demo-player.js
```

Draw from the state and wire the controls by hand:

```js
import {
  createDemoPlayer,
  demoOptionsFromUrl,
  handleDemoKey,
} from "./demo-player.js";

const player = createDemoPlayer({ duration: 2, ...demoOptionsFromUrl() });
const render = () => {
  const { progress, playing, ended } = player.getState();
  draw(progress);
  play.textContent = playing ? "Pause" : ended ? "Replay" : "Play";
  scrub.style.setProperty("--demo-progress", String(progress));
};
player.subscribe(render);
render();
player.observe(stage); // Starts when most of the stage is in view.
play.addEventListener("click", () => player.toggle());
scrub.addEventListener("keydown", (event) => {
  if (handleDemoKey(player, event)) event.preventDefault();
});
// Pointer: beginScrub() on down, seek(time) on move, endScrub() on up.
```

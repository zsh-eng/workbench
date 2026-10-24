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

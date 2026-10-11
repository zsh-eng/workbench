# @workbench/elements

Headless parts for Elements pages and demos. See
[Elements pages and demos](../../docs/ELEMENTS.md) for the page shape and the
demo contract.

- `@workbench/elements`: `createDemoPlayer`, `driveAnimations`,
  `handleDemoKey`, `demoOptionsFromUrl`. No framework.
- `@workbench/elements/react`: `useDemoPlayer` with prop getters for the
  stage, Play, Replay or Reset, and the scrubber; `useActiveSection`.
- `@workbench/elements/frames`: `DEVICES`, `FrameMessage`,
  `useDeviceRowScale`, `useNearView`, `useFrameSelection`.

The package exports TypeScript source. It works with React 18 and 19.

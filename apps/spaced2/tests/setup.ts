import { mock } from "bun:test";
import { Window } from "happy-dom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { createRequire } from "node:module";
import * as React from "react";

// vite.config.ts dedupes React. @workbench/elements finds its React peer from
// the workspace root, which can be another version, so tests give it this
// app's React in the same way.
const sharedReact = createRequire(
  require.resolve("@workbench/elements/react"),
).resolve("react");
if (sharedReact !== require.resolve("react")) mock.module(sharedReact, () => React);

const testWindow = new Window({ url: "http://localhost:5178" });
const browserGlobals = [
  "window", "document", "navigator", "location", "localStorage", "sessionStorage",
  "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement",
  "Element", "Node", "Text", "Document", "DocumentFragment", "SVGElement",
  "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent",
  "MutationObserver", "ResizeObserver", "DOMParser", "getComputedStyle",
] as const;
for (const key of browserGlobals) {
  const value = key === "window" ? testWindow : testWindow[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
Object.assign(globalThis, {
  indexedDB, IDBKeyRange, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: testWindow.requestAnimationFrame.bind(testWindow),
  cancelAnimationFrame: testWindow.cancelAnimationFrame.bind(testWindow),
});
Object.assign(testWindow, { indexedDB, IDBKeyRange });

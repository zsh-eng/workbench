// The browser test files share one page per worker (isolate: false in
// vitest.config.ts), so that the app loads once and not once per file. Each
// file starts as in a page of its own: the first page's size and no saved
// state, whatever the file before it left. The page hears the cleared storage
// as it would another window's clear, so that what the app keeps of it reads
// anew.
import { page } from "vitest/browser";

const start = ((
  globalThis as { __medTestPage?: { width: number; height: number } }
).__medTestPage ??= { width: innerWidth, height: innerHeight });
localStorage.clear();
sessionStorage.clear();
dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage }));
await page.viewport(start.width, start.height);

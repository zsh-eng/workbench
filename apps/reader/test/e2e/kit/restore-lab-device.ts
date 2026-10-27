import type { BrowserContext, Page } from "@playwright/test";
import {
  hasCover,
  LAB_API,
  LAB_APP_ORIGIN,
  LAB_SIZES,
  labAccount,
  type LabSize,
} from "../../../scripts/restore-lab";

/**
 * agent-kit `--before` for the restore lab (`scripts/restore-lab.ts`):
 * accepts the lab's self-signed certificate, signs in to the account of
 * RESTORE_LAB_SIZE from the app's page, as its sign-in does, and records
 * when each milestone of a restore first holds (`fresh-restore.ts`).
 */
export default async function restoreLabDevice({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  const size = (process.env.RESTORE_LAB_SIZE ?? "large") as LabSize;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.goto(`${LAB_APP_ORIGIN}/`);
  const status = await page.evaluate(
    async ({ api, account }) =>
      (
        await fetch(`${api}/api/auth/sign-in/email`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(account),
        })
      ).status,
    { api: LAB_API, account: labAccount(size) },
  );
  if (status !== 200) throw new Error(`Sign-in failed: ${status}`);
  const { books } = LAB_SIZES[size];
  await context.addInitScript(recordMilestones, {
    origin: LAB_APP_ORIGIN,
    books,
    covers: Array.from({ length: books }, (_, i) => i).filter(hasCover).length,
  });
}

/**
 * In the page, from navigation start: the first book on screen (`shelf`),
 * every book (`allBooks`), the covers on screen and all covers in place of
 * their placeholders, and the end of the restore's pull (`restored`).
 * `emptyUntil` is the last frame before the shelf that said the library
 * was empty.
 */
function recordMilestones(expected: {
  origin: string;
  books: number;
  covers: number;
}) {
  if (location.origin !== expected.origin) return;
  const marks: Record<string, number> = {};
  (window as { __restoreLab?: Record<string, number> }).__restoreLab = marks;
  const tick = () => {
    const now = Math.round(performance.now());
    const ready = document.querySelector('[aria-busy="false"]');
    const links = [
      ...document.querySelectorAll<HTMLElement>('main a[aria-label^="Open "]'),
    ];
    // Links come in page order: stop at the first one below the screen.
    // The Reading shelf scrolls sideways; its books past the edge are not
    // on screen.
    const onScreen: HTMLElement[] = [];
    for (const link of links) {
      const box = link.getBoundingClientRect();
      if (box.top >= innerHeight) break;
      if (box.bottom > 0 && box.width > 0 && box.left < innerWidth)
        onScreen.push(link);
    }
    // A cover that arrived late keeps its placeholder underneath.
    const blurred = (link: Element) =>
      link.querySelector("canvas[data-blur-hash]") !== null &&
      link.querySelector("img") === null;
    // Until the first book, the last frame that invited you to add books.
    if (
      marks.shelf === undefined &&
      [...document.querySelectorAll("p")].some(
        (p) => p.textContent === "Your library is empty",
      )
    )
      marks.emptyUntil = now;
    if (ready && onScreen.length > 0) marks.shelf ??= now;
    if (ready && links.length >= expected.books) marks.allBooks ??= now;
    if (
      marks.allBooks !== undefined &&
      onScreen.length > 0 &&
      !onScreen.some(blurred)
    )
      marks.screenCovers ??= now;
    if (
      marks.allBooks !== undefined &&
      document.querySelectorAll('main a[aria-label^="Open "] img').length >=
        expected.covers &&
      !links.some(blurred)
    )
      marks.allCovers ??= now;
    if (
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("epub-reader-sync-v2-state") &&
          localStorage.getItem(key)!.includes('"bootstrapped":true'),
      )
    )
      marks.restored ??= now;
    if (marks.restored === undefined || marks.allCovers === undefined)
      requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

import type { KitContext } from "../../../../../packages/agent-kit/kit";
import {
  LAB_API,
  labAccount,
  labLibrary,
  type LabSize,
} from "../../scripts/first-sync-lab";

/**
 * agent-kit `--before` for the first-sync lab (`scripts/first-sync-lab.ts`):
 * signs in to the account of FIRST_SYNC_SIZE from the app's page, as the
 * app's sign-in does, and records when each milestone of a first sync
 * first holds (`first-sync.ts` reads them).
 */
export default async function firstSyncDevice({
  page,
  context,
  baseURL,
}: KitContext) {
  const size = (process.env.FIRST_SYNC_SIZE ?? "medium") as LabSize;
  await page.goto(baseURL);
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
  const { articles } = labLibrary(size);
  await context.addInitScript(recordMilestones, {
    origin: new URL(baseURL).origin,
    saved: articles.filter((item) => item.saved && !item.archived).length,
  });
  return {};
}

/**
 * In the page, from navigation start: the last blank frame, the first
 * frame of the library, the first placeholder, the first card on screen,
 * every saved link listed (`allListed`, by the count), the covers on screen
 * loaded after that, each namespace's first pull done, and the end of the
 * first sync. `screen`
 * keeps each change of the cards on the first screen.
 */
function recordMilestones(expected: { origin: string; saved: number }) {
  if (location.origin !== expected.origin) return;
  const marks: Record<string, number> = {};
  const screen: [number, number][] = [];
  const lab = { marks, screen };
  (window as { __firstSync?: typeof lab }).__firstSync = lab;
  const listed = `${expected.saved.toLocaleString()} articles`;
  let last = "";
  const tick = () => {
    const now = Math.round(performance.now());
    const root = document.getElementById("root");
    if (!root || root.childElementCount === 0) marks.blankUntil = now;
    else marks.shell ??= now;
    const onScreen: HTMLElement[] = [];
    if (document.querySelector(".waiting")) marks.placeholder ??= now;
    // Real cards name their article; placeholder cards do not.
    for (const card of document.querySelectorAll<HTMLElement>(
      ".card[data-id]",
    )) {
      const box = card.getBoundingClientRect();
      if (box.top >= innerHeight) break;
      if (box.bottom > 0 && box.width > 0) onScreen.push(card);
    }
    if (onScreen.length) marks.firstCard ??= now;
    const ids = onScreen.map((card) => card.dataset.id).join(",");
    if (ids !== last) {
      screen.push([now, onScreen.length]);
      last = ids;
    }
    const count = document.querySelector(".shelf-count")?.textContent;
    if (count === listed) marks.allListed ??= now;
    if (
      marks.allListed !== undefined &&
      onScreen.length > 0 &&
      onScreen.every(
        (card) =>
          !card.matches("[data-image]") ||
          card.querySelector(".cover img[data-loaded]"),
      )
    )
      marks.screenImages ??= now;
    for (const key of Object.keys(localStorage)) {
      const match = /^arctic:[^:]+:(arctic[a-z-]*):sync$/.exec(key);
      if (match && localStorage.getItem(key)!.includes('"bootstrapped":true'))
        marks[`pulled:${match[1]}`] ??= now;
      if (
        key.endsWith(":sync-status") &&
        localStorage.getItem(key)!.includes('"lastSyncedAt"')
      )
        marks.synced ??= now;
    }
    if (marks.synced === undefined || marks.screenImages === undefined)
      requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

import type { BrowserContext, Page } from "@playwright/test";
import { LAB_API, labAccount, type LabSize } from "../../scripts/restore-lab";

/**
 * agent-kit `--before` for the restore lab (`scripts/restore-lab.ts`):
 * accepts the lab's self-signed certificate, signs in to the account of
 * RESTORE_LAB_SIZE from the app's page, and records when each milestone of
 * a restore first holds (`fresh-restore.ts`). The app is the kit's URL, so
 * a before and an after build can alternate behind the one link.
 */
export default async function restoreLabDevice({
  page,
  context,
  baseURL,
}: {
  page: Page;
  context: BrowserContext;
  baseURL: string;
}) {
  const size = (process.env.RESTORE_LAB_SIZE ?? "large") as LabSize;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Security.setIgnoreCertificateErrors", { ignore: true });
  await page.goto(`${baseURL}/profile`);
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
  await context.addInitScript(recordMilestones, { origin: baseURL });
}

/**
 * In the page, from navigation start: the first due card on screen with
 * its grade buttons (`firstReview`), the end of the restore's pull
 * (`restored`), and the first frame after both with no "Restoring" text
 * anywhere (`settled`). `counts` lists each change of the due count beside
 * the Spaced icon, with whether a "Restoring" text was on screen.
 */
function recordMilestones(expected: { origin: string }) {
  if (location.origin !== expected.origin) return;
  const marks: Record<string, number> & {
    counts?: [number, string, boolean][];
  } = { counts: [] };
  (window as { __restoreLab?: typeof marks }).__restoreLab = marks;
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > 0 &&
      box.top < innerHeight &&
      box.right > 0 &&
      box.left < innerWidth
    );
  };
  const tick = () => {
    const now = Math.round(performance.now());
    const restoring = /Restoring/.test(document.body?.innerText ?? "");
    const blocked = /Restoring your cards/.test(
      document.querySelector("main")?.textContent ?? "",
    );
    if (blocked) marks.blockedUntil = now;
    const card = [...document.querySelectorAll("main article")].some(
      (article) => visible(article) && article.textContent!.trim() !== "",
    );
    const good = [...document.querySelectorAll("main button")].some(
      (button) =>
        button.textContent!.trim() === "Good" &&
        !(button as HTMLButtonElement).disabled &&
        visible(button),
    );
    if (card && good && !blocked) marks.firstReview ??= now;
    const count = document.querySelector('a[href="/"]')?.textContent?.trim();
    const last = marks.counts!.at(-1);
    if (count !== undefined && (last?.[1] !== count || last?.[2] !== restoring))
      marks.counts!.push([now, count, restoring]);
    if (
      Object.keys(localStorage).some(
        (key) =>
          key.startsWith("spaced-records-v3-state") &&
          localStorage.getItem(key)!.includes('"bootstrapped":true'),
      )
    )
      marks.restored ??= now;
    if (
      marks.restored !== undefined &&
      marks.firstReview !== undefined &&
      !restoring
    )
      marks.settled ??= now;
    if (marks.settled === undefined) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

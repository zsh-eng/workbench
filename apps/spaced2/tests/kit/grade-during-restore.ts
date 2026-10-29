import type { BrowserContext, Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * agent-kit `--steps` for the restore lab, after `restore-lab-device.ts`:
 * a new device opens Review and, as soon as a card is answerable, grades
 * RESTORE_LAB_GRADES (5) cards "Good" while the rest restores, one every
 * RESTORE_LAB_GRADE_GAP_MS (3,000). Each grade is timed from the tap to
 * the next card's front on screen. It returns the
 * median and appends the grades to RESTORE_LAB_OUT. The grades reach the
 * lab account when the restore's push runs, so use an account kept for it.
 */
export default async function gradeDuringRestore({
  page,
  context,
  baseURL,
}: {
  page: Page;
  context: BrowserContext;
  baseURL: string;
}) {
  await page.goto("about:blank");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", {
    origin: baseURL,
    storageTypes: "indexeddb,local_storage,cache_storage,service_workers",
  });
  await cdp.detach();
  await page.goto(`${baseURL}/`);
  await page.waitForFunction(
    () =>
      (window as { __restoreLab?: Record<string, unknown> }).__restoreLab
        ?.firstReview !== undefined,
    undefined,
    { timeout: 600_000, polling: 100 },
  );
  const grades: { ms: number; at: number; restored: boolean }[] = [];
  for (let n = 0; n < Number(process.env.RESTORE_LAB_GRADES ?? 5); n++) {
    if (n > 0)
      await page.waitForTimeout(
        Number(process.env.RESTORE_LAB_GRADE_GAP_MS ?? 3_000),
      );
    grades.push(
      await page.evaluate(
        () =>
          new Promise<{ ms: number; at: number; restored: boolean }>(
            (resolve) => {
              const front = () =>
                document.querySelector("main article")?.textContent ?? "";
              const before = front();
              const good = [...document.querySelectorAll("main button")].find(
                (button) => button.textContent!.trim() === "Good",
              ) as HTMLButtonElement;
              const start = performance.now();
              good.click();
              const check = () => {
                if (front() === before || front() === "")
                  return requestAnimationFrame(check);
                const marks = (
                  window as { __restoreLab?: Record<string, number> }
                ).__restoreLab!;
                resolve({
                  ms: Math.round(performance.now() - start),
                  at: Math.round(start),
                  restored: marks.restored !== undefined,
                });
              };
              requestAnimationFrame(check);
            },
          ),
      ),
    );
  }
  await page.waitForFunction(
    () =>
      (window as { __restoreLab?: Record<string, unknown> }).__restoreLab
        ?.settled !== undefined,
    undefined,
    { timeout: 600_000, polling: 250 },
  );
  const marks = await page.evaluate(
    () => (window as { __restoreLab?: Record<string, number> }).__restoreLab!,
  );
  appendFileSync(
    process.env.RESTORE_LAB_OUT ??
      join(tmpdir(), "agent-kit", "spaced-restore-lab-grades.jsonl"),
    JSON.stringify({
      app: baseURL,
      size: process.env.RESTORE_LAB_SIZE ?? "large",
      marks,
      grades,
    }) + "\n",
  );
  const sorted = grades.map((grade) => grade.ms).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

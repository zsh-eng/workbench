// Measures Med's chrome on the demo world: the height from the window's top
// to the first diff line, and the controls that show around the code.
//
//   node scripts/explorations/measure-chrome.mjs --port 6502 --out <dir> [--shots]
//
// Build Med first. Each case opens a thread, shows its Changes tab, and
// measures in both chrome modes ("full" and "quiet", the med:chrome:v1 key)
// at 1440 and 900 px wide. chrome-measure.mjs says what counts as a control.
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { buildWorld } from "./world.mjs";
import { openStage } from "./stage.mjs";
import { measure } from "./chrome-measure.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const port = Number(option("port", "6502"));
const out = resolve(option("out", join(tmpdir(), "med-chrome")));
const shots = args.includes("--shots");
const modes = option("modes", "full,quiet").split(",");
const widths = option("widths", "1440,900").split(",").map(Number);
const light = args.includes("--light");

const cases = [
  { name: "session", thread: "Daylight saving times", note: "a thread with its session" },
  { name: "review", thread: "Week view", note: "a review without a session" },
];

const world = await buildWorld(join(out, "world"));
const stage = await openStage({ world, port, out, theme: light ? "light" : "dark" });
const { page } = stage;
const results = [];
try {
  const sidebar = page.locator("aside").first();
  await sidebar.getByText("Week view", { exact: true }).first().waitFor({ timeout: 20_000 });
  for (const mode of modes) {
    await page.evaluate((value) => localStorage.setItem("med:chrome:v1", value), mode);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const item of cases) {
        // A narrow window shows the sidebar over the workspace.
        if (!(await sidebar.isVisible().catch(() => false)))
          await page.getByRole("button", { name: "Show sidebar" }).first().click();
        await sidebar.getByText(item.thread, { exact: true }).first().click();
        await page
          .locator('[data-review-status="ready"]')
          .filter({ visible: true })
          .first()
          .waitFor({ timeout: 20_000 });
        await page.waitForTimeout(400);
        await page.evaluate(() =>
          [...document.querySelectorAll('[role=tab][aria-label="Changes"]')]
            .find((tab) => tab.getBoundingClientRect().width > 0)
            ?.click(),
        );
        await page.waitForTimeout(900);
        const result = await page.evaluate(measure);
        const row = { mode, width, case: item.name, thread: item.thread, ...result };
        results.push(row);
        console.log(
          `${mode.padEnd(5)} ${String(width).padEnd(4)} ${item.name.padEnd(7)} first line ${row.firstLine} px · ${row.controls.length} controls`,
        );
        if (shots) await page.screenshot({ path: join(out, `${mode}-${width}-${item.name}.png`) });
      }
    }
  }
} finally {
  await writeFile(join(out, "chrome.json"), JSON.stringify(results, null, 2));
  const closed = await stage.close();
  if (closed.errors.length) console.log("page errors:", closed.errors);
}

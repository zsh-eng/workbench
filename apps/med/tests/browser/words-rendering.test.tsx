import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { SessionMarkdown } from "../../src/web/components/session/SessionMarkdown";
import MarkdownPreview from "../../src/web/components/MarkdownPreview";
import { createMarkdownModel } from "../../src/web/markdown/model";
import type { FileRead } from "../../src/shared/local-file";
import { viewSettings } from "../../src/web/data/view-settings";
// The thread's own rules for a reply's prose, as the thread loads them.
import "../../src/web/components/session/SessionThread.css";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
  viewSettings.wordsMarkdown.set("off");
});

const REPLY = [
  "## What changed",
  "",
  "Set $HOME first, then $$e^{i\\pi} + 1 = 0$$ holds.[^why]",
  "",
  "See [the pull request](https://github.com/zsh-eng/workbench/pull/1).",
  "",
  "| File | Lines |",
  "| :--- | ----: |",
  "| `src/web/markdown/render.worker.ts` | 303 |",
  "",
  "- [x] Parse with Words",
  "- [ ] Port the preview",
  "",
  "<details>",
  "<summary>The **long** version</summary>",
  "",
  "Hidden until opened.",
  "",
  "</details>",
  "",
  "Done.",
  "",
  "[^why]: Euler's identity.",
].join("\n");

async function show(text = REPLY) {
  await page.viewport(1280, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "700px", padding: "40px" });
  document.body.append(frame);
  root = createRoot(frame);
  root.render(<SessionMarkdown text={text} streaming={false} />);
  await expect.element(page.getByText("Done.")).toBeVisible();
}

test("with the setting on, a reply renders in Pierre Words as it would in remark, and again in remark once it is off", async () => {
  viewSettings.wordsMarkdown.set("on");
  await show();
  const note = () => frame!.querySelector<HTMLAnchorElement>("a[data-footnote-ref]");
  // Words numbers a footnote where remark names it by its label.
  await expect.poll(() => note()?.getAttribute("href")).toBe("#user-content-fn-1");
  expect(document.getElementById("user-content-fn-1")).not.toBeNull();

  // $HOME is text and $$ is math, as in any reply.
  await expect.element(page.getByText(/Set \$HOME first, then/)).toBeVisible();
  expect(frame!.querySelector(".katex")).not.toBeNull();
  // Its outline heading, a pill for a web link, a cell that breaks at its
  // separators, and a task list.
  expect(frame!.querySelector("h2")?.id).toBe("md-what-changed");
  const link = frame!.querySelector<HTMLAnchorElement>("a.med-web-link");
  expect(link?.dataset.site).toBe("github");
  expect(link?.target).toBe("_blank");
  expect(frame!.querySelector("td wbr")).not.toBeNull();
  expect(frame!.querySelectorAll(".contains-task-list .task-list-item")).toHaveLength(2);
  // The fold shows its summary and opens to what it holds.
  const summary = page.getByText("long", { exact: true });
  await expect.element(summary).toBeVisible();
  await expect.element(page.getByText("Hidden until opened.")).not.toBeVisible();
  await userEvent.click(summary);
  await expect.element(page.getByText("Hidden until opened.")).toBeVisible();

  viewSettings.wordsMarkdown.set("off");
  await expect.poll(() => note()?.getAttribute("href")).toBe("#user-content-fn-why");
});

const NOTE = [
  "# Queue worker",
  "",
  "The worker takes the next job. See [[Retries|the retry plan]].",
  "",
  "## Holds",
  "",
  "| Queue | Holds |",
  "| :---- | ----: |",
  "| mail | 4 |",
  "",
  "```ts",
  "const hold = 30;",
  "```",
  "",
  "## Retries",
  "",
  "Each retry waits twice as long.[^1]",
  "",
  "[^1]: Up to a minute.",
].join("\n");

test("with the setting on, a note's preview renders in Pierre Words: its blocks' lines, its outline, and its wiki links", async () => {
  viewSettings.wordsMarkdown.set("on");
  await page.viewport(1600, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "1000px", height: "600px", display: "flex" });
  document.body.append(frame);
  root = createRoot(frame);
  const file = {
    source: { kind: "local", path: "/test/notes/Queue worker.md" },
    path: "Queue worker.md",
    kind: "text",
    size: NOTE.length,
    identity: "queue",
    vault: { root: "/test/notes" },
    text: NOTE,
  } as unknown as FileRead;
  root.render(<MarkdownPreview model={createMarkdownModel(NOTE)} file={file} />);
  const reading = page.getByRole("region", { name: "Markdown preview" });
  await expect.element(reading.getByRole("heading", { name: "Queue worker" })).toBeVisible();
  await expect
    .poll(() => frame!.querySelector("a[data-footnote-ref]")?.getAttribute("href"))
    .toBe("#user-content-fn-1");
  const lines = [...frame!.querySelectorAll<HTMLElement>("[data-block-line]")].map(
    (block) => `${block.dataset.blockLine}-${block.dataset.blockEnd}`,
  );
  expect(lines).toEqual(["1-1", "3-3", "5-5", "7-9", "11-13", "15-15", "17-17", "18-18"]);
  expect(frame!.querySelector("table")?.dataset.sourceLine).toBe("7");
  expect(frame!.querySelector("pre")?.dataset.sourceEnd).toBe("13");
  expect(frame!.querySelector<HTMLAnchorElement>("a[data-vault-link]")?.dataset.vaultLink).toBe(
    "Retries",
  );
});

import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { HistoryPanel } from "../../src/web/components/HistoryPanel";
import type { CommitDetails } from "../../src/shared/protocol";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
let now: number;
function render(ages?: number[], loadDetails?: (id: string) => Promise<CommitDetails>) {
  now = Date.now();
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "height:800px;width:400px";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <HistoryPanel
      commits={
        ages
          ? ages.map((age, index) => ({
              id: String(index).padStart(40, "0"),
              parents: [],
              subject: `Commit ${index + 1}`,
              author: "Alex",
              timestamp: now - age,
              refs: [],
            }))
          : [
              {
                id: "a".repeat(40),
                parents: ["b".repeat(40)],
                subject: "First commit subject",
                author: "Alex",
                timestamp: now - 60_000,
                refs: ["main"],
              },
              {
                id: "b".repeat(40),
                parents: [],
                subject: "Second commit subject",
                author: "Sam",
                timestamp: now - 3_600_000,
                refs: [],
              },
            ]
      }
      loading={false}
      hasMore={false}
      error={null}
      working={false}
      onSelect={() => {}}
      onLoadMore={() => {}}
      onWorking={() => {}}
      loadDetails={loadDetails}
    />,
  );
}

test("shows compact elapsed author times and a commit card in a shared tooltip", async () => {
  await page.viewport(1280, 800);
  render(undefined, async (id) => ({
    id,
    body: "Explains the change.",
    coAuthors: ["Sam"],
    files: 2,
    additions: 5,
    deletions: 1,
  }));
  const first = page.getByRole("option").nth(0);
  const second = page.getByRole("option").nth(1);
  await expect
    .poll(() => document.querySelectorAll('[role="option"] time')[0]?.textContent)
    .toBe("1 min ago");
  await expect
    .poll(() => document.querySelectorAll('[role="option"] time')[1]?.textContent)
    .toBe("1 hr ago");
  expect(document.querySelector('[role="option"][title]')).toBeNull();
  expect(document.querySelector("time[title]")).toBeNull();

  // Observe the popup timestamp so browser automation latency does not affect
  // the initial delay or fast scanning assertions.
  let openedAt = 0;
  let secondAt = 0;
  const observer = new MutationObserver(() => {
    const text = document.querySelector('[role="tooltip"]')?.textContent;
    if (text?.includes("First commit subject") && !openedAt) openedAt = performance.now();
    if (text?.includes("Second commit subject") && !secondAt) secondAt = performance.now();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  try {
    const started = performance.now();
    await first.hover();
    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
      .toContain("Explains the change.");
    expect(openedAt - started).toBeGreaterThanOrEqual(400);
    expect(document.querySelector('[role="tooltip"] time')?.getAttribute("datetime")).toBe(
      new Date(now - 60_000).toISOString(),
    );
    const card = document.querySelector('[role="tooltip"]')?.textContent;
    for (const text of ["Alex with Sam", "aaaaaaa", "main", "2 files", "+5", "−1"])
      expect(card).toContain(text);
    const scannedAt = performance.now();
    await second.hover();
    await expect
      .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
      .toContain("Second commit subject");
    expect(secondAt - scannedAt).toBeLessThan(350);
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
  } finally {
    observer.disconnect();
  }
});

test("updates relative times while the history stays open", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  render();
  await expect
    .poll(() => document.querySelector('[role="option"] time')?.textContent)
    .toBe("1 min ago");
  await vi.advanceTimersByTimeAsync(60_000);
  await expect
    .poll(() => document.querySelector('[role="option"] time')?.textContent)
    .toBe("2 min ago");
});

test("renders recent, older, and future author dates as relative times", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const minute = 60_000;
  const day = 24 * 60 * minute;
  render([0, day, 29 * day, 30 * day, 365 * day, 730 * day, -minute]);
  await expect
    .poll(() =>
      [...document.querySelectorAll('[role="option"] time')].map((node) => node.textContent),
    )
    .toEqual([
      "just now",
      "1 day ago",
      "29 days ago",
      "1 mo ago",
      "1 yr ago",
      "2 yr ago",
      "in 1 min",
    ]);
});

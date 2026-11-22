import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { AppTooltip, tooltip } from "../../src/web/components/ToolButton";

// A tooltip of more than one line: its lines are of even length, its box is
// as wide as its longest line, a path wraps after a slash, and a text's own
// breaks stay.

let root: Root;
let host: HTMLElement;
const show = async (label: string, detail?: string) => {
  root.render(
    <>
      <button type="button" {...tooltip(label, undefined, undefined, detail)}>
        Control
      </button>
      <AppTooltip />
    </>,
  );
  await expect.poll(() => host.querySelector("button")).not.toBeNull();
  // A tooltip opens at once for the keyboard's focus.
  await userEvent.tab();
  await expect.poll(() => document.querySelector('[role="tooltip"]')).not.toBeNull();
  const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  // Open: no longer at the smaller scale that it starts from.
  await expect
    .poll(() => getComputedStyle(tip).transform)
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  return tip;
};

/** The lines that a tooltip shows: each one's words and its width. */
function linesOf(tip: HTMLElement) {
  const rows = new Map<number, { text: string; left: number; right: number }>();
  const range = document.createRange();
  const texts = document.createTreeWalker(tip, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode())
    for (let at = 0; at < node.textContent!.length; at++) {
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const box = range.getClientRects()[0];
      if (!box?.width) continue;
      const row = rows.get(Math.round(box.top)) ?? { text: "", left: box.left, right: box.right };
      row.text += node.textContent![at];
      row.left = Math.min(row.left, box.left);
      row.right = Math.max(row.right, box.right);
      rows.set(Math.round(box.top), row);
    }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => ({ text: row.text.trim(), width: row.right - row.left }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});

test("a long tooltip wraps into even lines, in a box as wide as its longest line", async () => {
  const tip = await show("Claude Code has this session open in a terminal. Med can't type there.");
  const lines = linesOf(tip);
  expect(lines).toHaveLength(2);
  // No last word alone: the shorter line is most of the longer one.
  const [short, long] = lines.map((line) => line.width).sort((a, b) => a - b) as [number, number];
  expect(short / long).toBeGreaterThan(0.75);
  // The box ends where its longest line does, not at its widest.
  const edges =
    parseFloat(getComputedStyle(tip).paddingLeft) +
    parseFloat(getComputedStyle(tip).paddingRight) +
    2;
  expect(tip.getBoundingClientRect().width).toBeLessThan(long + edges + 2);
  expect(tip.getBoundingClientRect().width).toBeLessThan(300);
});

test("a path wraps after a slash, not inside a name", async () => {
  const path = "apps/reader/src/features/library/components/shelves/ArrivingBooksShelfSection.tsx";
  const tip = await show(path);
  const lines = linesOf(tip);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(0, -1)) expect(line.text).toMatch(/\/$/);
  // The text is the path, with nothing added to it.
  expect(tip.textContent).toBe(path);
});

test("a text's own breaks stay", async () => {
  const tip = await show(
    "Fork from here",
    "Starts a new session from\nthis point. This one stays as it is.",
  );
  expect(linesOf(tip).map((line) => line.text)).toEqual([
    "Fork from here",
    "Starts a new session from",
    "this point. This one stays as it is.",
  ]);
});

test("a line that the text names evens its own wraps", async () => {
  const tip = await show(
    "feature/forgiving-station-search\nWorktree: /Users/sam/code/transit-worktrees/forgiving-station-search",
  );
  const lines = linesOf(tip);
  expect(lines).toHaveLength(3);
  expect(lines[0]!.text).toBe("feature/forgiving-station-search");
  const [short, long] = [lines[1]!.width, lines[2]!.width].sort((a, b) => a - b) as [
    number,
    number,
  ];
  expect(short / long).toBeGreaterThan(0.6);
});

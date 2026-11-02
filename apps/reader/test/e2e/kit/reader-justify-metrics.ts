import type { Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { waitForReaderReady } from "../helpers/fixtures";

interface PageLines {
  /** Each full line's word space, as a share of its natural width. */
  spaceRatios: number[];
  /** How far each justified line's end sits from the text column's edge. */
  edgeErrors: number[];
  hyphenLines: number;
  lines: number;
  /** Full lines left ragged while the rest of the page is justified. */
  raggedLines: string[];
}

/** `JUSTIFY_EDGE_SLACK_PX` in layout-text-lines.ts. */
const EDGE_SLACK_PX = 3;

function percentileOf(sorted: number[], share: number): number {
  return sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
}

/**
 * agent-kit steps that read the page's word spaces: turns `KIT_TURNS` pages
 * (40 by default) past the first `KIT_SKIP` (6), and prints the word-space
 * ratios (1 is natural; a left-aligned line counts as if it were stretched to
 * the edge, as a browser's own justification would), the justified lines'
 * edge error and the share of lines that end in a hyphen. With `KIT_RECORD`,
 * also appends them to that file as one JSON line.
 */
export default async function justifyMetrics({ page }: { page: Page }) {
  await waitForReaderReady(page);
  const skip = Number(process.env.KIT_SKIP ?? "6");
  const turns = Number(process.env.KIT_TURNS ?? "40");
  for (let turn = 0; turn < skip; turn++) {
    await page.keyboard.press("ArrowRight");
    await waitForReaderReady(page);
  }

  const seen: PageLines[] = [];
  for (let turn = 0; turn < turns; turn++) {
    seen.push(
      await page.evaluate((edgeSlackPx) => {
        const context = document.createElement("canvas").getContext("2d")!;
        const range = document.createRange();
        const result: PageLines = {
          spaceRatios: [],
          edgeErrors: [],
          hyphenLines: 0,
          lines: 0,
          raggedLines: [],
        };
        const justifying = document.querySelector(
          "[data-reader-slice-type='text'] > span[style*='word-spacing']",
        );
        const paragraphs = document.querySelectorAll<HTMLElement>(
          "[data-reader-current-page] [data-reader-slice-type='text']",
        );
        for (const paragraph of paragraphs) {
          const column = paragraph.getBoundingClientRect();
          const lines = [...paragraph.children].filter(
            (child): child is HTMLElement => child.tagName === "SPAN",
          );
          lines.forEach((line, index) => {
            result.lines += 1;
            const text = line.textContent ?? "";
            if (/\p{L}-$/u.test(text)) result.hyphenLines += 1;
            // A paragraph's last line may end on the next page, and sets
            // loosely by design.
            if (index === lines.length - 1) return;
            const spaces = (text.trimEnd().match(/[  ]/g) ?? []).length;
            if (spaces === 0) return;
            const inner = line.firstElementChild ?? line;
            context.font = getComputedStyle(inner).font;
            const natural = context.measureText(" ").width;
            range.selectNodeContents(line);
            const textRight = range.getBoundingClientRect().right;
            const wordSpacing = parseFloat(line.style.wordSpacing);
            if (Number.isNaN(wordSpacing)) {
              if (justifying) {
                result.raggedLines.push(text);
              } else {
                const added = (column.right - textRight) / spaces;
                result.spaceRatios.push((natural + added) / natural);
              }
              return;
            }
            // Word spacing stops short of the edge by a slack that the
            // browser's justification spreads over the same spaces.
            const added = wordSpacing + edgeSlackPx / spaces;
            result.spaceRatios.push((natural + added) / natural);
            result.edgeErrors.push(textRight - column.right);
          });
        }
        return result;
      }, EDGE_SLACK_PX),
    );
    await page.keyboard.press("ArrowRight");
    await waitForReaderReady(page);
  }

  const ratios = seen
    .flatMap((lines) => lines.spaceRatios)
    .sort((a, b) => a - b);
  const errors = seen
    .flatMap((lines) => lines.edgeErrors)
    .sort((a, b) => a - b);
  const ragged = seen.flatMap((lines) => lines.raggedLines);
  const lines = seen.reduce((total, page) => total + page.lines, 0);
  const hyphenLines = seen.reduce((total, page) => total + page.hyphenLines, 0);
  const summary = {
    lines,
    fullLines: ratios.length,
    spaceRatioP50: percentileOf(ratios, 0.5),
    spaceRatioP95: percentileOf(ratios, 0.95),
    spaceRatioMax: ratios.at(-1) ?? 0,
    spaceRatioMin: ratios[0] ?? 0,
    edgeErrorMin: errors[0] ?? 0,
    edgeErrorMax: errors.at(-1) ?? 0,
    raggedLines: ragged.length,
    hyphenLineShare: lines > 0 ? hyphenLines / lines : 0,
  };
  console.log(JSON.stringify(summary));
  if (process.env.KIT_RECORD) {
    appendFileSync(process.env.KIT_RECORD, `${JSON.stringify(summary)}\n`);
  }
}

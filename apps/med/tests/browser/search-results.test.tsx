import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import type { BrowseRead, BrowseSource } from "../../src/shared/browse";
import type { BrowseSearch } from "../../src/shared/inspect";
import { SearchView, type SearchOpen } from "../../src/web/components/SearchView";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

const checkout: BrowseSource = { kind: "worktree", repo: "/fixture" };
const commit: BrowseSource = { kind: "commit", repo: "/fixture", oid: "a".repeat(40) };
// A comment that the match on line 20 sits in: only the whole file's
// highlighting knows that line 20 is a comment.
const alpha = [
  "/*",
  ...Array.from({ length: 18 }, (_, i) => ` * note ${i}`),
  " * needle in a comment",
  "*/",
  "const one = 1;",
  "const two = 2;",
  "const three = 3;",
  "export const needle = 2;",
  ...Array.from({ length: 14 }, (_, i) => `const filler${i} = ${i};`),
  "const Needle = 3;",
  "const last = 4;",
].join("\n");
const files = new Map<string, string>([
  ["src/alpha.ts", alpha],
  ...Array.from(
    { length: 40 },
    (_, i) =>
      [
        `src/more/file${i}.ts`,
        `const a = 1;\nconst needle${i} = ${i};\nconst b = 2;\nconst c = 3;\nconst d = 4;\n`,
      ] as const,
  ),
]);

/** The Search tab over `files`; the host reads `resultSource`'s files. */
function fixture(resultSource: BrowseSource = commit, contents = files) {
  const reads: string[] = [];
  const opened: SearchOpen[] = [];
  const api = {
    async search(source: BrowseSource, query: string): Promise<BrowseSearch> {
      const matches = [...contents].flatMap(([path, text]) =>
        text
          .split("\n")
          .flatMap((line, index) =>
            line.toLowerCase().includes(query.toLowerCase())
              ? [{ path, line: index + 1, text: line }]
              : [],
          ),
      );
      return { source, query, matches, truncated: false, resultSource, engine: "git" };
    },
    async read(source: BrowseSource, path: string): Promise<BrowseRead> {
      reads.push(path);
      const text = contents.get(path)!;
      return { source, path, kind: "text", size: text.length, identity: `${path}:1`, text };
    },
  };
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "height:600px;width:900px;display:flex;flex-direction:column";
  document.body.append(mount);
  const view = createRoot(mount);
  root = view;
  const show = (query: string) =>
    view.render(
      <WorkerPoolContextProvider
        highlighterOptions={{ theme: "github-dark" }}
        poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      >
        <SearchView
          api={api}
          source={checkout}
          repository={{ id: "fixture", name: "fixture", path: "/fixture" }}
          repositories={[]}
          query={query}
          active
          focusRequest={0}
          onQueryChange={() => {}}
          onOpen={(open) => opened.push(open)}
          onLeave={() => {}}
        />
      </WorkerPoolContextProvider>,
    );
  show("needle");
  return { reads, opened, show };
}

const file = (path: string) =>
  document.querySelector<HTMLElement>(`section[aria-label="fixture ${path}"]`);
/** Each excerpt's line numbers. */
const excerptLines = (path: string) =>
  [...(file(path)?.querySelectorAll(":scope > div") ?? [])].map((excerpt) =>
    [...excerpt.children].map((row) => Number(row.firstElementChild?.textContent)),
  );
const color = (node: Element | null | undefined) =>
  node ? getComputedStyle(node).color : undefined;

test("results show two lines around each match, merged when they meet, highlighted as the file view highlights them", async () => {
  const { opened } = fixture();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("43 results in 41 files in fixture");
  // Matches on lines 20 and 25 share one excerpt; line 40 has its own.
  await expect.poll(() => file("src/alpha.ts")?.dataset.highlighted).toBe("");
  expect(excerptLines("src/alpha.ts")).toEqual([
    [18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    [38, 39, 40, 41],
  ]);
  const options = file("src/alpha.ts")!.querySelectorAll('[role="option"]');
  expect([...options].map((option) => option.textContent)).toEqual([
    "20 * needle in a comment",
    "25export const needle = 2;",
    "40const Needle = 3;",
  ]);

  // Each match is marked in its syntax colors: in the comment, the comment's
  // color, which only the whole file's highlighting gives line 20.
  const marks = [...file("src/alpha.ts")!.querySelectorAll("mark")];
  expect(marks.map((mark) => mark.textContent)).toEqual(["needle", "needle", "Needle"]);
  const comment = color(options[0]!.querySelector("code span"));
  expect(color(marks[0]!.querySelector("span"))).toBe(comment);
  const keyword = color(options[1]!.querySelector("code span"));
  expect(keyword).not.toBe(comment);
  expect(getComputedStyle(marks[0]!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

  // A context line opens the file at that line, at the commit searched.
  (file("src/alpha.ts")!.querySelector(":scope > div > div") as HTMLElement).click();
  expect(opened.at(-1)).toMatchObject({ path: "src/alpha.ts", line: 18, source: commit });

  // ⌥C matches case: the line with "Needle" goes.
  await page.getByRole("combobox", { name: "Search query" }).click();
  await userEvent.keyboard("{Alt>}c{/Alt}");
  await expect
    .element(page.getByRole("button", { name: "Match case" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("42 results in 41 files in fixture");
  expect(excerptLines("src/alpha.ts")).toEqual([[18, 19, 20, 21, 22, 23, 24, 25, 26, 27]]);
});

test("only the files near the view are read and highlighted", async () => {
  const { reads } = fixture();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("43 results in 41 files in fixture");
  await expect.poll(() => reads.length).toBeGreaterThan(2);
  const listbox = page.getByRole("listbox", { name: "Results" }).element();
  const scroller = listbox.parentElement!;
  // The first files load; the far ones wait, with their lines in place.
  await expect.poll(() => file("src/more/file0.ts")?.dataset.highlighted).toBe("");
  expect(reads).not.toContain("src/more/file39.ts");
  expect(reads.length).toBeLessThan(files.size);
  const before = file("src/more/file39.ts")!.getBoundingClientRect().height;
  scroller.scrollTop = scroller.scrollHeight;
  await expect.poll(() => file("src/more/file39.ts")?.dataset.highlighted).toBe("");
  expect(file("src/more/file39.ts")!.getBoundingClientRect().height).toBe(before);
  expect(new Set(reads).size).toBe(reads.length);
});

test("a checkout's results show its working files: a file that changed is read again for the next search, and a match opens the working file", async () => {
  const working = new Map([["src/alpha.ts", alpha]]);
  const { reads, opened, show } = fixture(checkout, working);
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("3 results in 1 file in fixture");
  await expect.poll(() => file("src/alpha.ts")?.dataset.highlighted).toBe("");
  expect(excerptLines("src/alpha.ts")).toEqual([
    [18, 19, 20, 21, 22, 23, 24, 25, 26, 27],
    [38, 39, 40, 41],
  ]);

  // An edit adds a line at the top; the next search finds each match a line
  // lower, and the excerpts show the file as it is now.
  working.set("src/alpha.ts", `// Added\n${alpha}`);
  show("needl");
  await expect.poll(() => excerptLines("src/alpha.ts")[1]).toEqual([39, 40, 41, 42]);
  await expect.poll(() => file("src/alpha.ts")?.dataset.highlighted).toBe("");
  expect(reads.filter((path) => path === "src/alpha.ts")).toHaveLength(2);
  const options = file("src/alpha.ts")!.querySelectorAll('[role="option"]');
  expect([...options].map((option) => option.textContent)).toEqual([
    "21 * needle in a comment",
    "26export const needle = 2;",
    "41const Needle = 3;",
  ]);

  // A match opens the working file at its line.
  (options[1] as HTMLElement).click();
  expect(opened.at(-1)).toMatchObject({ path: "src/alpha.ts", line: 26, source: checkout });
});

import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import CommitView from "../../src/web/components/CommitView";
import "../../src/web/pierre-theme";
import type { CommitApi, WorkingFile, WorkingStatus } from "../../src/web/data/commit";
import { initializeTheme, themeController } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

/**
 * A checkout that Git and another program, such as an agent, share. Files
 * are names with a version of their content; a stage can wait for the test
 * and then fail, as when another Git process holds the index lock.
 */
function createCheckout(changed: string[], staged: string[] = []) {
  // Each file's content on disk and in the index, as a version.
  const work = new Map(changed.map((path) => [path, 1]));
  const index = new Map(staged.map((path) => [path, 1]));
  let gate: Promise<void> | undefined;
  let hookFails = false;
  const commits: string[][] = [];
  const blob = (content: number) => content.toString(16).padStart(40, "0");
  const row = (path: string): WorkingFile => ({
    path,
    staged: index.has(path) ? "modified" : null,
    unstaged: index.get(path) === work.get(path) ? null : "modified",
  });
  const status = (): WorkingStatus => ({
    repo: "/test/repo",
    branch: "main",
    head: "a".repeat(40),
    upstream: { remote: "origin", branch: "main" },
    ahead: 0,
    behind: 0,
    pushRemote: "origin",
    indexKey: `${commits.length}:${[...index].toSorted().join(",")}`,
    files: [...work.keys()].toSorted().map(row),
  });
  // Each file's change from HEAD to the working file, as git diff --full-index writes it.
  const patch = (path: string, content: number) =>
    `diff --git a/${path} b/${path}\nindex ${blob(0)}..${blob(content)} 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${path} at HEAD\n+${path}, version ${content}\n`;
  const api: CommitApi = {
    status: async () => status(),
    changes: async (file) => ({
      path: file.path,
      staged: index.has(file.path) ? patch(file.path, index.get(file.path)!) : "",
      unstaged: "",
      binary: false,
      tooLarge: false,
    }),
    diff: async () => ({
      id: `diff-${[...work].join(",")}`,
      files: [...work.keys()].toSorted().map((path) => ({
        path,
        status: "M",
        additions: 1,
        deletions: 1,
        binary: false,
      })),
      patch: [...work]
        .toSorted()
        .map(([path, content]) => patch(path, content))
        .join(""),
    }),
    async stage(paths, stage) {
      // git add --all -- paths, or every change without paths.
      await gate;
      for (const path of paths ?? [...work.keys()]) {
        if (stage && work.has(path)) index.set(path, work.get(path)!);
        if (!stage) index.delete(path);
      }
      return status();
    },
    // As the host does: Commit all stages in a copy of the index, and the
    // commit holds the files the tab showed, with the content it showed.
    async commit({ message, indexKey, files, all }) {
      if (indexKey !== status().indexKey)
        throw new Error("The staged files or the branch changed since this view loaded.");
      const next = new Map(index);
      if (all)
        for (const { path } of files ?? []) if (work.has(path)) next.set(path, work.get(path)!);
      if (files) {
        if (
          [...next.keys()].toSorted().join("\0") !==
          files
            .map((file) => file.path)
            .toSorted()
            .join("\0")
        )
          throw new Error(
            "The staged files changed since you pressed Commit. Check them, then commit again.",
          );
        if (files.some((file) => file.object && file.object !== blob(next.get(file.path)!)))
          throw new Error(
            "A file changed after the tab showed it. Check the changes, then commit again.",
          );
      }
      if (!next.size) throw new Error("Nothing is staged.");
      if (hookFails)
        throw new Error("The commit did not complete.\n\nlint: a.ts needs a semicolon");
      commits.push([...next.keys()].toSorted());
      for (const [path, content] of next) if (work.get(path) === content) work.delete(path);
      index.clear();
      return { head: "b".repeat(40), summary: message };
    },
    push: async (head) => ({ head, remote: "origin", branch: "main" }),
  };
  return {
    api,
    commits,
    staged: () => [...index.keys()].toSorted(),
    /** Another program writes a new file, or a new version of one. */
    write(path: string) {
      work.set(path, (work.get(path) ?? 0) + 1);
    },
    /** Another program stages a file. */
    stage(path: string) {
      index.set(path, work.get(path)!);
    },
    /** The pre-commit hook fails. */
    failHook(fails: boolean) {
      hookFails = fails;
    },
    /** The next stages wait until the returned function runs. */
    holdStages() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        gate = undefined;
      });
      return release;
    },
    /** The next stages wait, then fail. */
    lockIndex() {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        gate = undefined;
        throw new Error("Another git process seems to be running in this repository.");
      });
      return release;
    },
  };
}

function render(api: CommitApi) {
  initializeTheme();
  themeController.commit("graphite-dark");
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:commit-message:")) localStorage.removeItem(key);
  mount = document.createElement("div");
  mount.style.cssText = "height:600px;width:1000px;display:flex;flex-direction:column";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<CommitView api={api} revision={0} active />);
}

const files = () => page.getByRole("listbox", { name: "Changed files" });
const rows = () =>
  files()
    .getByRole("option")
    .elements()
    .map((element) => element.getAttribute("aria-label"));

test("Commit all commits the files that its dialog counted, not a file that came after", async () => {
  const checkout = createCheckout(["a.ts", "b.ts"]);
  render(checkout.api);
  await expect.poll(rows).toEqual(["a.ts, not staged, modified", "b.ts, not staged, modified"]);
  await expect.element(files()).toHaveFocus();
  await userEvent.keyboard("c");
  await expect.element(page.getByRole("heading", { name: "Commit all 2 files" })).toBeVisible();
  await userEvent.keyboard("Change a and b");
  // An agent writes a new file before Med reads the checkout again.
  checkout.write("n.ts");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.element(page.getByRole("status").filter({ hasText: "Committed " })).toBeVisible();
  expect(checkout.commits).toEqual([["a.ts", "b.ts"]]);
  await expect.poll(rows).toEqual(["n.ts, not staged, modified"]);
});

test("a stage that fails stops the commit that counted it, and keeps the message", async () => {
  const checkout = createCheckout(["a.ts", "b.ts"], ["a.ts"]);
  render(checkout.api);
  await expect.poll(rows).toEqual(["a.ts, staged, modified", "b.ts, not staged, modified"]);
  await expect.element(files()).toHaveFocus();
  const release = checkout.lockIndex();
  await userEvent.keyboard("j ");
  await expect.poll(rows).toEqual(["a.ts, staged, modified", "b.ts, staged, modified"]);
  await userEvent.keyboard("c");
  await expect.element(page.getByRole("heading", { name: "Commit 2 files" })).toBeVisible();
  await userEvent.keyboard("Change a and b");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  release();
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toMatchTextContent(/^The staged files changed since you pressed Commit\./);
  expect(checkout.commits).toEqual([]);
  await expect
    .element(page.getByRole("textbox", { name: "Commit summary" }))
    .toHaveValue("Change a and b");
  await userEvent.keyboard("{Escape}");
  await expect.poll(rows).toEqual(["a.ts, staged, modified", "b.ts, not staged, modified"]);
});

test("a file that another program stages while your stage is on its way stops the commit", async () => {
  const checkout = createCheckout(["a.ts", "b.ts"]);
  render(checkout.api);
  await expect.poll(rows).toEqual(["a.ts, not staged, modified", "b.ts, not staged, modified"]);
  await expect.element(files()).toHaveFocus();
  const release = checkout.holdStages();
  await userEvent.keyboard(" ");
  await userEvent.keyboard("c");
  await expect.element(page.getByRole("heading", { name: "Commit 1 file" })).toBeVisible();
  await userEvent.keyboard("Change a");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  // An agent runs git add on b before Git answers the stage.
  checkout.stage("b.ts");
  release();
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toMatchTextContent(/^The staged files changed since you pressed Commit\./);
  expect(checkout.commits).toEqual([]);
});

test("Commit all after a hook fails leaves the files unstaged, as git commit -a does, and keeps the message", async () => {
  const checkout = createCheckout(["a.ts", "b.ts"]);
  checkout.failHook(true);
  render(checkout.api);
  await expect.poll(rows).toEqual(["a.ts, not staged, modified", "b.ts, not staged, modified"]);
  await expect.element(files()).toHaveFocus();
  await userEvent.keyboard("c");
  await expect.element(page.getByRole("heading", { name: "Commit all 2 files" })).toBeVisible();
  await userEvent.keyboard("Change a and b");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toMatchTextContent("lint: a.ts needs a semicolon");
  expect(checkout.commits).toEqual([]);
  expect(checkout.staged()).toEqual([]);
  await expect
    .element(page.getByRole("textbox", { name: "Commit summary" }))
    .toHaveValue("Change a and b");
  await userEvent.keyboard("{Escape}");
  await expect.poll(rows).toEqual(["a.ts, not staged, modified", "b.ts, not staged, modified"]);
});

test("a file that an agent changes after the tab showed it stops the commit, and keeps the message", async () => {
  const checkout = createCheckout(["a.ts", "b.ts"]);
  render(checkout.api);
  const stream = page.getByRole("region", { name: "Changes to commit" });
  await expect.element(stream.getByText("a.ts, version 1")).toBeInTheDocument();
  await expect.element(files()).toHaveFocus();
  await userEvent.keyboard("c");
  await userEvent.keyboard("Change a and b");
  // The agent writes a.ts again before Med reads the checkout.
  checkout.write("a.ts");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toMatchTextContent(/^A file changed after the tab showed it\./);
  expect(checkout.commits).toEqual([]);
  expect(checkout.staged()).toEqual([]);
  await expect
    .element(page.getByRole("textbox", { name: "Commit summary" }))
    .toHaveValue("Change a and b");
});

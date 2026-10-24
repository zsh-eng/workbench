import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import CommitView from "../../src/web/components/CommitView";
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
 * are names; a stage can wait for the test and then fail, as when another
 * Git process holds the index lock.
 */
function createCheckout(changed: string[], staged: string[] = []) {
  const work = new Set(changed);
  const index = new Set(staged);
  let version = 0;
  let gate: Promise<void> | undefined;
  const commits: string[][] = [];
  const row = (path: string): WorkingFile => ({
    path,
    staged: index.has(path) ? "modified" : null,
    unstaged: index.has(path) ? null : "modified",
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
    files: [...work].toSorted().map(row),
  });
  const api: CommitApi = {
    status: async () => status(),
    changes: async (file) => ({
      path: file.path,
      staged: "",
      unstaged: "",
      binary: false,
      tooLarge: false,
    }),
    diff: async () => ({ id: `diff-${version}`, files: [], patch: "" }),
    async stage(paths, stage) {
      // git add --all -- paths, or every change without paths.
      await gate;
      for (const path of paths ?? [...work]) {
        if (stage && work.has(path)) index.add(path);
        if (!stage) index.delete(path);
      }
      version++;
      return status();
    },
    async commit(message, indexKey) {
      if (indexKey !== status().indexKey)
        throw new Error("The staged files or the branch changed since this view loaded.");
      if (!index.size) throw new Error("Nothing is staged.");
      commits.push([...index].toSorted());
      for (const path of index) work.delete(path);
      index.clear();
      version++;
      return { head: "b".repeat(40), summary: message };
    },
    push: async (head) => ({ head, remote: "origin", branch: "main" }),
  };
  return {
    api,
    commits,
    /** Another program writes a new file. */
    write(path: string) {
      work.add(path);
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

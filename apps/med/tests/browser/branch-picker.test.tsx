import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BranchStrip, BranchSwitch, useBranchTabs } from "../../src/web/components/BranchTabs";
import { BranchPicker } from "../../src/web/components/BranchPicker";
import type { RegisteredRepository } from "../../src/shared/protocol";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});
function repository(id: string, path: string, name = id): RegisteredRepository {
  return {
    id,
    name,
    path,
    branches: [
      { name: "main", head: "a".repeat(40), current: true, worktreePath: path },
      { name: "release", head: "b".repeat(40), current: false },
    ],
    worktrees: [
      { path, head: "a".repeat(40), branch: "main" },
      { path: `${path}-detached`, head: "c".repeat(40), branch: "Detached HEAD" },
    ],
  };
}
async function setup(
  initial = [repository("frontend", "/repos/frontend"), repository("backend", "/repos/backend")],
) {
  const selections: string[] = [];
  function Harness() {
    const [repositories, setRepositories] = useState(initial);
    const [activeRepositoryId, setActiveRepository] = useState(initial[0]!.id);
    const [activeBranch, setActiveBranch] = useState<string | null>("main");
    const [repo, setRepo] = useState(initial[0]!.path);
    const [pickerOpen, setPickerOpen] = useState(false);
    // The same parts App places: the strip, the switcher, and the picker.
    const model = useBranchTabs({
      repositories,
      activeRepositoryId,
      activeBranch,
      repo,
      error: null,
      onBranch: (branch, id) => {
        selections.push(`${id}:${branch}`);
        setActiveRepository(id);
        setActiveBranch(branch);
        setRepo(repositories.find((entry) => entry.id === id)!.path);
      },
      onWorktree: (path, id) => {
        selections.push(`${id}:${path}`);
        setActiveRepository(id);
        setActiveBranch(null);
        setRepo(path);
      },
    });
    return (
      <>
        <BranchStrip model={model} />
        <BranchSwitch model={model} onOpen={() => setPickerOpen(true)} />
        <BranchPicker
          repositories={repositories}
          entries={model.entries}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={model.open}
          onRefresh={async () => {}}
          onAddRepository={async (path) => {
            if (path === "/missing") throw new Error("Repository does not exist.");
            setRepositories((current) => [...current, repository(path.split("/").at(-1)!, path)]);
          }}
          onRemoveRepository={async (id) => {
            setRepositories((current) => current.filter((entry) => entry.id !== id));
          }}
        />
      </>
    );
  }
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<Harness />);
  await expect
    .element(page.getByRole("button", { name: "Open branch", exact: true }))
    .toBeVisible();
  return { selections };
}

test("groups identical branches by repository and focuses existing cross-repository tabs", async () => {
  const { selections } = await setup();
  // One open branch needs no strip; the switcher names it.
  await expect
    .element(page.getByRole("button", { name: "Open branch", exact: true }))
    .toHaveTextContent("frontend/main");
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  await expect
    .element(page.getByRole("tab", { name: "backend / main", exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await expect.element(page.getByRole("group", { name: "frontend", exact: true })).toBeVisible();
  await expect.element(page.getByRole("group", { name: "backend", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search branches" }).fill("backend main");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("tab", { name: "backend / main", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  expect(selections.at(-1)).toBe("backend:main");
  await page.getByRole("tab", { name: "frontend / main", exact: true }).click();
  expect(selections.at(-1)).toBe("frontend:main");
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill("backend main");
  await userEvent.keyboard("{Enter}");
  expect(document.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1);
  expect(
    [...document.querySelectorAll('[role="tab"]')].filter(
      (node) => node.getAttribute("aria-label") === "backend / main",
    ),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Close backend / main", exact: true }).click();
  await expect
    .element(page.getByRole("tablist", { name: "Branches and worktrees" }))
    .not.toBeInTheDocument();
  expect(selections.at(-1)).toBe("frontend:main");
});

test("searches canonical paths, qualifies matching repo names, and opens detached worktrees", async () => {
  const { selections } = await setup([
    repository("one", "/work/one/project", "project"),
    repository("two", "/work/two/project", "project"),
  ]);
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await expect.element(page.getByRole("group", { name: "one/project", exact: true })).toBeVisible();
  await expect.element(page.getByRole("group", { name: "two/project", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search branches" }).fill("/work/two/project-detached");
  await userEvent.keyboard("{Enter}");
  expect(selections.at(-1)).toBe("two:/work/two/project-detached");
  await expect
    .element(page.getByRole("tab", { name: "two/project / Detached · ccccccc", exact: true }))
    .toHaveAttribute("aria-selected", "true");
});

test("adds repositories, reports failures, removes their tabs, and keeps committed-only sources explicit", async () => {
  await setup();
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await expect
    .element(page.getByRole("option", { name: "release Committed files only · bbbbbbb" }).first())
    .toBeVisible();
  await page.getByRole("button", { name: "Add repository…" }).click();
  await page.getByRole("textbox", { name: "Repository path" }).fill("/missing");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Repository does not exist.");
  await page.getByRole("textbox", { name: "Repository path" }).fill("/repos/shared");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.element(page.getByRole("group", { name: "shared", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Search branches" }).fill("shared main");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("tab", { name: "shared / main", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByText("Manage repositories", { exact: true }).click();
  await page.getByRole("button", { name: "Remove repository shared", exact: true }).click();
  await expect
    .element(page.getByRole("tab", { name: "shared / main", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Remove repository shared", exact: true }))
    .not.toBeInTheDocument();
});

test("shows a limit instead of silently closing tabs and frees capacity when a tab closes", async () => {
  const many = repository("frontend", "/repos/frontend");
  many.branches = Array.from({ length: 34 }, (_, index) => ({
    name: index ? `branch-${index}` : "main",
    head: "a".repeat(40),
    current: !index,
    worktreePath: `/repos/tree-${index}`,
  }));
  many.worktrees = [];
  await setup([many]);
  for (let index = 1; index <= 31; index++) {
    await page.getByRole("button", { name: "Open branch", exact: true }).click();
    await page.getByRole("combobox", { name: "Search branches" }).fill(`branch-${index}`);
    await userEvent.keyboard("{Enter}");
  }
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill("branch-32");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("You have 32 branch tabs open. Close a tab before opening another.");
  expect(document.querySelectorAll('[role="tab"]').length).toBe(32);
  await userEvent.keyboard("{Escape}");
  await page.getByRole("button", { name: "Close main", exact: true }).click();
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("tab", { name: "branch-32", exact: true })).toBeVisible();
});

test("bounds the result list while searching every branch", async () => {
  const many = repository("frontend", "/repos/frontend");
  many.branches = Array.from({ length: 250 }, (_, index) => ({
    name: index ? `branch-${index}` : "main",
    head: "a".repeat(40),
    current: !index,
  }));
  many.worktrees = [];
  await setup([many]);
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Showing the first 200 of 250 matches. Refine your search.");
  expect(document.querySelectorAll('[role="option"]').length).toBe(200);
  await page.getByRole("combobox", { name: "Search branches" }).fill("branch-249");
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("tab", { name: "branch-249", exact: true }))
    .toHaveAttribute("aria-selected", "true");
});

test("removes the final repository and starts with fresh branch tabs when it is added again", async () => {
  await setup([repository("frontend", "/repos/frontend")]);
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill("release");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("tab", { name: "release", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByText("Manage repositories", { exact: true }).click();
  await page.getByRole("button", { name: "Remove repository frontend", exact: true }).click();
  await expect.poll(() => document.querySelectorAll('[role="tab"]').length).toBe(0);
  await page.getByRole("button", { name: "Add repository…" }).click();
  await page.getByRole("textbox", { name: "Repository path" }).fill("/repos/frontend");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect.element(page.getByRole("group", { name: "frontend", exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect
    .element(page.getByRole("button", { name: "Open branch", exact: true }))
    .toHaveTextContent("frontend/release");
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
});

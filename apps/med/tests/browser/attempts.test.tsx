import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AttemptCompare, AttemptKept } from "../../src/shared/attempts";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { AttemptsHost } from "../../src/web/components/attempts/AttemptsHost";
import { NewThread } from "../../src/web/components/shell/NewThread";
import { openAttempts } from "../../src/web/data/attempts";
import type { WorkspaceInput } from "../../src/web/data/workspaces";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

const title = "Show a week of tides in the CLI";
const a = `r_${"a".repeat(24)}`;
const b = `r_${"b".repeat(24)}`;
const minute = 60_000;
const started = Date.now() - 60 * minute;
const repository = { id: "repo-1", name: "tide", path: "/code/tide" };
const threads: Thread[] = [
  {
    id: a,
    title,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: started + 37 * minute,
    repository,
    checkout: "/code/tide.worktrees/show-week-tides-cli-a",
    linked: true,
    branch: "show-week-tides-cli-a",
    agent: "claude",
    state: "idle",
    group: { id: "week-view", attempt: 1 },
  },
  {
    id: b,
    title,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: started + 22 * minute,
    repository,
    checkout: "/code/tide.worktrees/show-week-tides-cli-b",
    linked: true,
    branch: "show-week-tides-cli-b",
    agent: "codex",
    state: "idle",
    group: { id: "week-view", attempt: 2 },
  },
];
const patch = (path: string, before: string, after: string) =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,3 +1,3 @@\n import { tides } from "./tides";\n-${before}\n+${after}\n export {};\n`;
const added = (path: string, line: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+${line}\n`;
const compare: AttemptCompare = {
  group: "week-view",
  title,
  repository,
  base: { sha: "1".repeat(40), branch: "main" },
  attempts: [
    {
      threadId: a,
      attempt: 1,
      title,
      agent: "Claude",
      kind: "claude",
      model: "Opus 5.5",
      state: "idle",
      branch: "show-week-tides-cli-a",
      checkout: threads[0]!.checkout!,
      startedAt: started,
      endedAt: started + 37 * minute,
      changes: { files: 2, additions: 41, deletions: 3 },
      checks: [
        { command: "bun test", status: "failed", summary: "2 pass · 1 fail", at: started + minute },
      ],
      lastMessage: "Added `tide week`. One test still fails: `formatHeight` pads now.",
    },
    {
      threadId: b,
      attempt: 2,
      title,
      agent: "Codex",
      kind: "codex",
      model: "gpt-6-astra",
      state: "idle",
      branch: "show-week-tides-cli-b",
      checkout: threads[1]!.checkout!,
      startedAt: started,
      endedAt: started + 22 * minute,
      changes: { files: 2, additions: 30, deletions: 2 },
      checks: [
        { command: "bun test", status: "failed", summary: "5 pass · 1 fail", at: started + minute },
        { command: "bun test", status: "passed", summary: "6 pass", at: started + 2 * minute },
      ],
      lastMessage: "Added `tide week` with a test. All six tests pass.",
    },
  ],
  files: [
    {
      path: "src/cli.ts",
      changes: [
        {
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: patch("src/cli.ts", "run(day);", "run(args[0] === 'week' ? week : day);"),
        },
        {
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: patch("src/cli.ts", "run(day);", "run(command(args));"),
        },
      ],
    },
    {
      path: "src/week.ts",
      changes: [
        {
          status: "added",
          additions: 1,
          deletions: 0,
          patch: added("src/week.ts", "export const week = 7;"),
        },
        null,
      ],
    },
    {
      path: "tests/week.test.ts",
      changes: [
        null,
        {
          status: "added",
          additions: 1,
          deletions: 0,
          patch: added("tests/week.test.ts", "test('week', () => {});"),
        },
      ],
    },
  ],
};

const keptCompare: AttemptCompare = {
  ...compare,
  attempts: [compare.attempts[1]!],
  files: compare.files.flatMap((file) =>
    file.changes[1] ? [{ path: file.path, changes: [file.changes[1]] }] : [],
  ),
  kept: { threadId: b, attempt: 2 },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The host's attempts routes. */
function createHost() {
  const host = {
    reads: 0,
    /** After Keep and before Undo, the group has only B, and the host knows it was kept. */
    kept: false,
    keeps: [] as unknown[],
    undos: 0,
    fetch: vi.fn<typeof fetch>(async (input, init): Promise<Response> => {
      const url = new URL(String(input), location.origin);
      if (url.pathname === "/api/attempts") {
        host.reads++;
        return url.searchParams.get("group") === "week-view"
          ? json(host.kept ? keptCompare : compare)
          : json({ error: { code: "not-found", message: "No such group" } }, 404);
      }
      if (url.pathname === "/api/attempts/keep") {
        host.keeps.push(JSON.parse(String(init?.body)));
        host.kept = true;
        const kept: AttemptKept = {
          group: "week-view",
          threadId: b,
          attempt: 2,
          title,
          archived: [{ threadId: a, attempt: 1, removed: true, stopped: false }],
          notes: [],
        };
        return json(kept);
      }
      if (url.pathname === "/api/attempts/undo") {
        host.undos++;
        host.kept = false;
        return json({ restored: ["A with its worktree"] });
      }
      return json({ error: { code: "not-found", message: "Not found" } }, 404);
    }),
  };
  return host;
}

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
beforeEach(async () => {
  await page.viewport(1200, 820);
  localStorage.removeItem("med:new-thread");
  localStorage.removeItem("med:new-thread:attempts");
  history.replaceState(null, "", "/");
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  history.replaceState(null, "", "/");
});

function render(node: ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "position: fixed; inset: 0;";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(node);
}

const cells = (path: string) => [
  ...document.querySelectorAll<HTMLElement>(`[data-attempt-file][data-attempt-path="${path}"]`),
];
const factRow = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="row"]')].find(
    (row) => row.querySelector('[role="rowheader"]')?.textContent === label,
  );

test("the Attempts page compares the attempts side by side, and Keep offers Undo", async () => {
  const host = createHost();
  const opened: WorkspaceInput[] = [];
  render(
    <AttemptsHost
      threads={threads}
      fetcher={host.fetch}
      actions={{ open: (input) => void opened.push(input) }}
      onLeave={() => {}}
    />,
  );
  openAttempts("week-view");

  // One column for each attempt: who did it, how long, its changes, its checks.
  const main = page.getByRole("main", { name: "Attempts" });
  await expect.element(main.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect.element(main).toMatchTextContent("2 attempts from main 1111111");
  const names = [...document.querySelectorAll<HTMLElement>("[data-attempt]")];
  expect(names.map((name) => name.textContent)).toEqual([
    expect.stringContaining("Claude · Opus 5.5"),
    expect.stringContaining("Codex · gpt-6-astra"),
  ]);
  const cellsOf = (label: string) =>
    [...factRow(label)!.querySelectorAll('[role="cell"]')].map((cell) => cell.textContent);
  expect(cellsOf("Status")).toEqual([
    expect.stringContaining("Done · 37 min"),
    expect.stringContaining("Done · 22 min"),
  ]);
  expect(cellsOf("Changes")).toEqual([
    expect.stringContaining("2 files+41−3"),
    expect.stringContaining("2 files+30−2"),
  ]);
  expect(cellsOf("Checks")).toEqual([
    expect.stringContaining("bun test2 pass · 1 fail"),
    expect.stringContaining("bun test5 pass · 1 failbun test6 pass"),
  ]);
  expect(factRow("Checks")!.querySelectorAll('[aria-label="Failed"]')).toHaveLength(2);
  expect(factRow("Checks")!.querySelectorAll('[aria-label="Passed"]')).toHaveLength(1);
  expect(cellsOf("Last message")[1]).toContain("All six tests pass.");

  // The file that both changed comes first, each attempt's diff in its column.
  expect(
    [...document.querySelectorAll<HTMLElement>("h3[data-attempt-path]")].map(
      (heading) => heading.dataset.attemptPath,
    ),
  ).toEqual(["src/cli.ts", "src/week.ts", "tests/week.test.ts"]);
  await expect.element(main).toMatchTextContent(/In both.*cli\.ts.*Only in A.*Only in B/);
  const [left, right] = cells("src/cli.ts").map((cell) => cell.getBoundingClientRect());
  expect(left!.top).toBe(right!.top);
  expect(left!.right).toBeLessThanOrEqual(right!.left);
  await expect
    .poll(() => cells("src/cli.ts").map((cell) => cell.textContent))
    .toEqual([expect.stringContaining("Changed+1−1"), expect.stringContaining("Changed+1−1")]);
  expect(cells("src/week.ts")[1]!.textContent).toBe("Not changed in B");

  // ← and → move between the attempts' Keep buttons; Enter keeps one.
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(main.getByRole("button", { name: "Keep A" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(main.getByRole("button", { name: "Keep B" })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(main.getByRole("button", { name: "Keep B" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => host.keeps).toEqual([{ group: "week-view", threadId: b }]);

  // The kept attempt opens as the thread; the notice offers Undo.
  expect(opened).toEqual([{ kind: "review", reviewId: b, title }]);
  const notice = page.getByRole("status").filter({ hasText: "Kept B." });
  await expect.element(notice).toMatchTextContent("Kept B. Archived A and removed its worktree.");
  await expect.element(notice.getByRole("button", { name: "Undo" })).toBeVisible();
});

test("Undo after Keep brings back the other attempt and shows the Attempts page again", async () => {
  const host = createHost();
  render(
    <AttemptsHost
      threads={threads}
      fetcher={host.fetch}
      actions={{ open() {} }}
      onLeave={() => {}}
    />,
  );
  openAttempts("week-view");
  await page.getByRole("button", { name: "Keep B" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Kept B." });
  // Leave the page, as opening the kept thread does in the window.
  history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(page.getByRole("main", { name: "Attempts" })).not.toBeInTheDocument();

  await notice.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => host.undos).toBe(1);
  await expect
    .element(page.getByRole("status"))
    .toMatchTextContent("Brought back A with its worktree.");
  expect(location.pathname).toBe("/attempts/week-view");
  await expect.element(page.getByRole("main", { name: "Attempts" })).toBeVisible();
});

test("after Keep the page says which attempt stays, and its Undo also clears the notice", async () => {
  const host = createHost();
  const view = (list: Thread[]) => (
    <AttemptsHost threads={list} fetcher={host.fetch} actions={{ open() {} }} onLeave={() => {}} />
  );
  render(view(threads));
  openAttempts("week-view");
  await page.getByRole("button", { name: "Keep B" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Kept B." });
  await expect.element(notice).toBeVisible();

  // A leaves the thread list, so the page reads the group again.
  root!.render(view([threads[1]!]));
  const main = page.getByRole("main", { name: "Attempts" });
  await expect.element(main).toMatchTextContent("You kept B, Codex · gpt-6-astra.");
  await main.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => host.undos).toBe(1);
  await expect.element(notice).not.toBeInTheDocument();
  await expect.element(main.getByRole("button", { name: "Keep A" })).toBeVisible();
});

test("a group that the host does not know says so, and Escape goes back", async () => {
  const host = createHost();
  const onLeave = vi.fn<() => void>();
  render(
    <AttemptsHost threads={[]} fetcher={host.fetch} actions={{ open() {} }} onLeave={onLeave} />,
  );
  history.pushState(null, "", "/attempts/gone");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect
    .element(page.getByRole("alert"))
    .toMatchTextContent("Med has no attempts in this group.");
  await userEvent.keyboard("{Escape}");
  // The page was not opened in this window, so it leaves to the workspace.
  expect(onLeave).toHaveBeenCalledOnce();
});

test("New thread starts a task as two attempts, each with its agent and its own branch", async () => {
  const requests: { preset: string; worktree: boolean; choices: unknown; group: unknown }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/agents")
      return json({
        agents: [
          { id: "claude", name: "Claude Code", kind: "claude", available: true },
          { id: "codex", name: "Codex", kind: "acp", available: true },
        ],
      });
    if (url.pathname === "/api/agents/claude/choices")
      return json({
        model: {
          id: "model",
          name: "Model",
          category: "model",
          value: "opus",
          options: [
            { value: "opus", name: "Opus 5.5" },
            { value: "haiku", name: "Haiku 4.5" },
          ],
        },
      });
    if (url.pathname === "/api/agents/codex/choices")
      return json({
        model: {
          id: "model",
          name: "Model",
          category: "model",
          value: "gpt-6",
          options: [
            { value: "gpt-6", name: "gpt-6" },
            { value: "gpt-6-astra", name: "gpt-6-astra" },
          ],
        },
      });
    if (url.pathname === "/api/threads" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      return json({
        review: {
          id: `r_${String(requests.length).repeat(24)}`,
          title: body.title,
          createdAt: "2026-10-15T00:00:00.000Z",
          revision: 0,
          commentCount: 0,
          targets: [],
          group: body.group,
        },
      });
    }
    return json({ error: { code: "not-found", message: "Not found" } }, 404);
  });
  const list: ThreadList = { threads: [], repositories: [repository] };
  const onStarted = vi.fn<(review: SavedReview) => void>();
  render(<NewThread list={list} fetcher={fetcher} onStarted={onStarted} onCancel={() => {}} />);
  const dialog = page.getByRole("dialog", { name: "New thread" });
  await dialog.getByRole("combobox", { name: "Task" }).fill(title);
  const chosen = (name: string) =>
    dialog
      .getByRole("radiogroup", { name, exact: true })
      .element()
      .querySelector('[aria-checked="true"]')?.textContent;
  await expect.poll(() => chosen("Model")).toBe("Opus 5.5");
  await dialog
    .getByRole("radiogroup", { name: "Attempts" })
    .getByRole("radio", { name: "2" })
    .click();

  // The agent's rows for each attempt, under its letter; B takes the other
  // agent. Each needs a worktree, so the checkout is not offered.
  await expect.element(dialog.getByRole("group", { name: "Attempt A" })).toBeVisible();
  const b = dialog.getByRole("group", { name: "Attempt B" });
  await expect.element(b).toBeVisible();
  expect(chosen("Agent for attempt A")).toBe("Claude Code");
  await expect.poll(() => chosen("Agent for attempt B")).toBe("Codex");
  // One click changes an attempt's agent, and its models follow.
  await b.getByRole("radio", { name: "Claude Code" }).click();
  await expect.poll(() => chosen("Model for attempt B")).toBe("Opus 5.5");
  await b.getByRole("radio", { name: "Codex" }).click();
  await expect
    .element(dialog.getByRole("radiogroup", { name: "Model", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(dialog.getByRole("radio", { name: /^Checkout/ })).not.toBeInTheDocument();
  await expect
    .element(
      dialog.getByText("New worktrees · show-week-tides-cli-a, show-week-tides-cli-b", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.poll(() => chosen("Model for attempt B")).toBe("gpt-6");
  await b.getByRole("radio", { name: "gpt-6-astra" }).click();

  await dialog.getByRole("button", { name: /^Start/ }).click();
  await expect.poll(() => requests.length).toBe(2);
  const group = (requests[0]!.group as { id: string }).id;
  expect(group).toMatch(/^show-week-tides-cli-[0-9a-f]{4}$/);
  expect(requests).toEqual([
    expect.objectContaining({
      preset: "claude",
      worktree: true,
      choices: { model: "opus" },
      group: { id: group, attempt: 1, label: "Claude Code · Opus 5.5" },
    }),
    expect.objectContaining({
      preset: "codex",
      worktree: true,
      choices: { model: "gpt-6-astra" },
      group: { id: group, attempt: 2, label: "Codex · gpt-6-astra" },
    }),
  ]);
  // The first attempt opens, with the Attempts page over it.
  await expect.poll(() => location.pathname).toBe(`/attempts/${group}`);
  expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: `r_${"1".repeat(24)}` }));
});

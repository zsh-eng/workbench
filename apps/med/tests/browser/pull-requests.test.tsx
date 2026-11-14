import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { PullRequestsPage, type PullInboxLoader } from "../../src/web/components/PullRequestsPage";
import type { PullInbox, PullInboxRow } from "../../src/shared/pull-inbox";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const row = (number: number, title: string, change: Partial<PullInboxRow> = {}): PullInboxRow => ({
  url: `https://github.com/acme/trailhead/pull/${number}`,
  number,
  title,
  repository: "acme/trailhead",
  author: "you",
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-08T00:00:00Z",
  draft: false,
  review: "required",
  checks: "pass",
  conflicts: false,
  additions: 12,
  deletions: 3,
  ...change,
});
const inbox = (all: boolean): PullInbox => ({
  viewer: "you",
  scope: all ? "all" : "registered",
  repositories: all ? [] : ["acme/trailhead"],
  readAt: new Date().toISOString(),
  waiting: [
    row(418, "Cache map tiles", { author: "maya", why: "review requested" }),
    row(412, "Retry uploads", { why: "checks failing", checks: "fail" }),
  ],
  yours: [
    row(420, "Search chips", {
      stack: [{ url: "https://github.com/acme/trailhead/pull/421", number: 421, title: "Clear" }],
    }),
    ...(all ? [row(9, "A change elsewhere", { repository: "acme/elsewhere" })] : []),
  ],
});

function setup(load: PullInboxLoader) {
  initializeTheme();
  const opened: [string, string | undefined][] = [];
  mount = document.createElement("div");
  mount.style.height = "700px";
  mount.style.display = "flex";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <PullRequestsPage
      load={load}
      onOpenPull={(url, agent) => opened.push([url, agent])}
      agents={[{ id: "claude", name: "Claude Code" }]}
    />,
  );
  return { opened };
}

test("what waits on you comes first, a stack is one row, and the keys open, review, or go to GitHub", async () => {
  const load = vi.fn<PullInboxLoader>(async (all) => inbox(all));
  const sheet = setup(load);
  const waiting = page.getByRole("group", { name: "Waiting on you" });
  await expect.element(waiting.getByRole("option")).toHaveLength(2);
  await expect.element(waiting.getByText("review requested")).toBeVisible();
  // Checks and the review's state are icons, named for a screen reader.
  await expect.element(waiting.getByLabelText("Checks failing")).toBeInTheDocument();
  const yours = page.getByRole("group", { name: "Yours" });
  await expect.element(yours.getByText("acme/trailhead #420 → #421")).toBeVisible();
  // The host's last list: under a minute old, so the page asks for no other.
  expect(load.mock.calls).toEqual([[false, "kept", expect.any(AbortSignal)]]);
  // The list has the keys at once. ↓ ↵ opens the second row in a worktree.
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(sheet.opened).toEqual([["https://github.com/acme/trailhead/pull/412", undefined]]);
  // ⌘↵ asks Claude to review it there.
  await userEvent.keyboard("k{Meta>}{Enter}{/Meta}");
  expect(sheet.opened.at(-1)).toEqual(["https://github.com/acme/trailhead/pull/418", "claude"]);
  // ⌥↵ opens it on GitHub.
  const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
  await userEvent.keyboard("jj{Alt>}{Enter}{/Alt}");
  expect(windowOpen).toHaveBeenCalledWith(
    "https://github.com/acme/trailhead/pull/420",
    "_blank",
    "noopener",
  );
  // All of GitHub reads again, without the repositories: two places to look,
  // so a click switches.
  const where = page.getByRole("button", { name: /^Where to look: Your/ });
  await expect.element(where).toHaveAccessibleDescription("Switch to All of GitHub");
  await userEvent.click(where);
  await expect
    .element(page.getByRole("button", { name: "Where to look: All of GitHub" }))
    .toBeVisible();
  await expect.element(page.getByText("A change elsewhere")).toBeVisible();
  expect(load).toHaveBeenLastCalledWith(true, "kept", expect.any(AbortSignal));
  // The refresh button asks the host for a new read.
  await userEvent.click(page.getByRole("button", { name: "Refresh pull requests" }));
  expect(load).toHaveBeenLastCalledWith(true, "new", expect.any(AbortSignal));
});

test("the page opens with the host's last list, then GitHub's; only the refresh button shows a read, and a failed one leaves a note", async () => {
  const kept = { ...inbox(false), readAt: new Date(Date.now() - 10 * 60_000).toISOString() };
  const answers: ((answer: PullInbox) => void)[] = [];
  const load = vi.fn<PullInboxLoader>((_all, want) =>
    want === "kept" ? Promise.resolve(kept) : new Promise((done) => answers.push(done)),
  );
  setup(load);
  // The kept list shows at once, with its time; its age asks for a fresh one,
  // and nothing says that a read runs.
  await expect.element(page.getByRole("option", { name: /Search chips/ })).toBeVisible();
  await expect.element(page.getByRole("status")).toHaveTextContent("Updated 10 min ago");
  await expect.poll(() => load.mock.calls.map(([, want]) => want)).toEqual(["kept", "fresh"]);
  const refresh = page.getByRole("button", { name: "Refresh pull requests" });
  await expect.element(refresh).toHaveAttribute("aria-busy", "false");
  await expect.element(page.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  // GitHub's answer replaces it.
  const fresh = { ...inbox(false), yours: [...inbox(false).yours, row(430, "Trail names")] };
  answers.shift()!(fresh);
  await expect.element(page.getByRole("option", { name: /Trail names/ })).toBeVisible();
  await expect.element(page.getByRole("status")).toHaveTextContent("Updated just now");

  // The refresh button asks for a new read and turns while it runs.
  await userEvent.click(refresh);
  expect(load).toHaveBeenLastCalledWith(false, "new", expect.any(AbortSignal));
  await expect.element(refresh).toHaveAttribute("aria-busy", "true");
  // A failed read keeps the list and says why, quietly.
  answers.shift()!({
    ...fresh,
    failed: { at: new Date().toISOString(), reason: "error connecting to api.github.com" },
  });
  await expect
    .element(page.getByRole("note"))
    .toHaveTextContent("Med could not refresh the list: error connecting to api.github.com");
  await expect.element(page.getByRole("option", { name: /Trail names/ })).toBeVisible();
  await expect.element(refresh).toHaveAttribute("aria-busy", "false");
  expect(page.getByRole("alert").query()).toBeNull();
});

test("with no list kept, the page's shape shows only when the first read takes a while", async () => {
  const answers: ((answer: PullInbox) => void)[] = [];
  setup(() => new Promise((done) => answers.push(done)));
  const shape = () =>
    document.querySelector<HTMLElement>("[role='listbox'] > [aria-hidden='true']");
  await expect.element(page.getByRole("listbox")).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => answers.length).toBe(1);
  // A brief read shows nothing; a longer one shows the shape. The shape's
  // own clock, held still, says so at each time.
  const [appear] = shape()!.getAnimations();
  appear!.pause();
  appear!.currentTime = 350;
  expect(getComputedStyle(shape()!).opacity).toBe("0");
  appear!.currentTime = 650;
  expect(getComputedStyle(shape()!).opacity).toBe("1");
  answers.shift()!(inbox(false));
  await expect.element(page.getByRole("option", { name: /Search chips/ })).toBeVisible();
  expect(shape()).toBeNull();
});

test("without gh, or with no GitHub remote, the sheet says why", async () => {
  setup(async (all) => ({
    ...inbox(all),
    waiting: [],
    yours: [],
    unavailable: "Install the GitHub CLI (gh) and run gh auth login to list pull requests.",
  }));
  await expect
    .element(
      page.getByText("Install the GitHub CLI (gh) and run gh auth login to list pull requests."),
    )
    .toBeVisible();
  expect(document.querySelectorAll("[role='option']")).toHaveLength(0);
});

test("a GitHub host that gh cannot read says why above the others' pull requests", async () => {
  setup(async (all) => ({
    ...inbox(all),
    skipped: [
      {
        host: "github.acme.build",
        reason: "You are not logged into any accounts on github.acme.build",
      },
    ],
  }));
  await expect
    .element(page.getByRole("note"))
    .toHaveTextContent(
      "Med could not read github.acme.build: You are not logged into any accounts on github.acme.build",
    );
  await expect.element(page.getByRole("option", { name: /Cache map tiles/ })).toBeVisible();
});

test("while the page shows, it asks for a fresh list every two minutes and when the window comes back, and a hidden window asks for none", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  let hidden = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  const load = vi.fn<PullInboxLoader>(async (all) => inbox(all));
  setup(load);
  const asks = () => load.mock.calls.map(([, want]) => want);
  // Each answer lands before the clock moves on.
  const pass = async (milliseconds: number) => {
    await vi.advanceTimersByTimeAsync(milliseconds);
    await new Promise((done) => setTimeout(done, 0));
  };
  const show = async (event: Event, target: EventTarget) => {
    target.dispatchEvent(event);
    await pass(0);
  };
  // The kept list is new, so the page asks for no other at first.
  await expect.poll(asks).toEqual(["kept"]);
  await pass(119_000);
  expect(asks()).toEqual(["kept"]);
  await pass(1_000);
  expect(asks()).toEqual(["kept", "fresh"]);
  // A hidden window asks for nothing.
  hidden = true;
  await show(new Event("visibilitychange"), document);
  await pass(10 * 60_000);
  expect(asks()).toHaveLength(2);
  // Back on screen, its list is old: it asks at once.
  hidden = false;
  await show(new Event("visibilitychange"), document);
  expect(asks()).toEqual(["kept", "fresh", "fresh"]);
  // Focus asks only when the list is a minute old.
  await pass(30_000);
  await show(new FocusEvent("focus"), window);
  expect(asks()).toHaveLength(3);
  await pass(31_000);
  await show(new FocusEvent("focus"), window);
  expect(asks()).toEqual(["kept", "fresh", "fresh", "fresh"]);
});

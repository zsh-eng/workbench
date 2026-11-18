import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Thread } from "../../src/shared/threads";
import {
  cleanUp,
  createHost,
  head,
  openThread,
  pages,
  prepareWindow,
  PULL_TREE,
  PULL_URL,
  pullReview,
  render,
  sessionShown,
  sessionThread,
  shown,
} from "./session-reviews-fixture";

beforeEach(prepareWindow);
afterEach(cleanUp);

test("Changes are the checkout of the review on screen: a pull request's worktree, then the session's again", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const host = createHost([{ ...thread, reviews: [...thread.reviews, pullReview(now - 9000)] }]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  const pulls = page.getByRole("region", { name: "Pull requests" });
  await expect.poll(shown).toBe("rev-a-target");

  // The session's own review is of the checkout where it works: its Changes
  // are that checkout's working changes, on the base branch.
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  expect(host.reviews.at(-1)).toEqual({ repo: "/test/repo", comparison: { kind: "working" } });

  // The pull request's review is in its own worktree. The session still
  // works in /test/repo; Changes are the worktree's branch, since the base
  // that the review names, not the repository's main.
  await pulls.getByRole("button", { name: /^Add durations/ }).click();
  await expect.poll(shown).toBe("pull-target");
  // Its row opens its own page, once its review shows.
  await expect.element(pages().getByRole("radio", { name: "Pull request" })).toBeChecked();
  // The band names the worktree by its branch, with no folder beside it:
  // the repository's name is the one part that copies the path.
  const band = page.getByRole("banner", { name: "Workspace" });
  await expect
    .element(band.getByRole("button", { name: "durations. Copy the branch name" }))
    .toBeVisible();
  expect(band.getByRole("button", { name: /\. Copy the path$/ }).elements()).toHaveLength(1);
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.at(-1)).toEqual({
    repo: PULL_TREE,
    comparison: { kind: "working", base: "release" },
  });
  await expect
    .element(page.getByRole("combobox", { name: "Comparison" }))
    .toMatchTextContent("durations since release");
  expect(sessionShown()).toBe(true);
  // The reader shows the agent's branch. These Changes are not the pull
  // request's: the row names the page, and no row of the rail is current.
  await page
    .getByRole("region", { name: "Agent" })
    .getByRole("button", { name: "main. Show the agent's branch" })
    .click();
  await expect.poll(shown).toBe("live-/test/repo");
  const apart = page.getByRole("heading", { name: "Changes", level: 2 });
  await expect.element(apart).toBeVisible();
  expect(pulls.element().querySelector("[aria-current]")).toBeNull();
  // The pull request's page is still its own, and its review leads again.
  await pulls.getByRole("button", { name: /^Add durations/ }).click();
  await expect.element(pages().getByRole("radio", { name: "Pull request" })).toBeChecked();
  await expect.element(apart).not.toBeInTheDocument();
  await pages().getByRole("radio", { name: "Review" }).click();
  await expect.poll(shown).toBe("pull-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  await expect.element(apart).not.toBeInTheDocument();
  // The session moves to another checkout. The Changes on screen are the
  // review's: they stay in its worktree.
  const moved = host.reviews.length;
  host.setThreads([
    {
      ...thread,
      checkout: "/test/worktrees/next",
      branch: "next",
      reviews: [...thread.reviews, pullReview(now - 9000)],
    },
  ]);
  // The rail says where the agent works now, and what the thread shows.
  await expect.element(page.getByRole("region", { name: "Agent" })).toMatchTextContent("next");
  await expect
    .element(page.getByRole("region", { name: "Thread" }))
    .toMatchTextContent("durations");
  expect(shown()).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.slice(moved)).toEqual([]);
  // The Review and its Changes are one place: going back and forth reads
  // no other checkout.
  const asked = host.reviews.length;
  await pages().getByRole("radio", { name: "Review" }).click();
  await expect.poll(shown).toBe("pull-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.slice(asked).map((request) => request.repo)).not.toContain("/test/repo");
  // Search reads the same checkout, and its match opens that checkout's file.
  const openTab = () =>
    document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title");
  await userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
  await userEvent.keyboard("after");
  await expect.poll(() => host.searches).toContain(`${PULL_TREE} after`);
  await expect.element(page.getByRole("option", { selected: true })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(openTab).toMatch(/^src\/tides\.ts · Working files · durations/);
  expect(host.searches.filter((search) => search.startsWith("/test/repo "))).toEqual([]);

  // The other review switches the place back. Its Changes are the session's
  // checkout's, and the worktree's file is not among its tabs.
  await reviews.getByRole("button", { name: /^Week view/ }).click();
  await expect.poll(shown).toBe("rev-a-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  expect(host.reviews.at(-1)).toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
  // The page is Changes, not the review's Guide: the workspace's pages still
  // answer after its review changed.
  await expect.element(page.getByRole("combobox", { name: "Comparison" })).toBeVisible();
  await expect.element(pages().getByRole("radio", { name: "Changes" })).toBeChecked();
  expect(page.getByRole("tab", { name: /tides\.ts/ }).query()).toBeNull();

  // The pull request's review again: its checkout, with the file that was open there.
  await pulls.getByRole("button", { name: /^Add durations/ }).click();
  await expect.poll(shown).toBe("pull-target");
  await pages().getByRole("radio", { name: "Files" }).click();
  await expect.element(page.getByRole("tab", { name: /tides\.ts/ })).toBeVisible();
  expect(sessionShown()).toBe(true);
});

test("the rail lists hand-offs under Reviews and pull requests in a section of their own, each with its number and state", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const [week, month] = thread.reviews;
  const withPulls = (state?: "open" | "merged"): Thread => ({
    ...thread,
    reviews: [
      week!,
      {
        ...month!,
        pullRequest: { url: "https://github.com/acme/tide/pull/3", number: 3, state: "open" },
      },
      pullReview(now - 9000, state),
    ],
    pullRequestUrl: "https://github.com/acme/tide/pull/3",
  });
  const host = createHost([withPulls()]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  const pulls = page.getByRole("region", { name: "Pull requests" });
  await expect.poll(shown).toBe("rev-a-target");
  // Reviews are what the agent handed off. The review that Med captured from
  // pull request #7's link is not one of them, and no row here has a number.
  await expect.element(reviews.getByRole("button", { name: /^Week view/ })).toBeVisible();
  await expect.element(reviews.getByRole("button", { name: /^Month view/ })).toBeVisible();
  expect(reviews.getByRole("button").elements()).toHaveLength(2);
  expect(reviews.element().textContent).not.toContain("#");
  // Each pull request has one row: a hand-off's, and the one from a link.
  await expect
    .element(pulls.getByRole("button", { name: "Month view. Pull request #3, open" }))
    .toMatchTextContent("#3");
  // Nothing has read #7 yet: the number alone.
  const seven = pulls.getByRole("button", { name: /^Add durations\. Pull request #7/ });
  await expect.element(seven).toHaveAccessibleName("Add durations. Pull request #7");
  expect(pulls.getByRole("button").elements()).toHaveLength(2);

  // The host read it: the row says the state, in its name and its mark.
  host.setThreads([withPulls("merged")]);
  await expect.element(seven).toHaveAccessibleName("Add durations. Pull request #7, merged");
  expect(seven.element().querySelector("[data-state]")?.getAttribute("data-state")).toBe("merged");
  expect(pulls.element().textContent?.match(/#7/g)).toHaveLength(1);

  // The row opens the pull request's own page, from another review too. It
  // is the one on screen then, and no hand-off is.
  await seven.click();
  await expect.poll(shown).toBe("pull-target");
  await expect.element(pages().getByRole("radio", { name: "Pull request" })).toBeChecked();
  await expect.element(seven).toHaveAttribute("aria-current", "true");
  expect(reviews.element().querySelector("[aria-current]")).toBeNull();
});

test("the rail names what the thread shows and where the agent works, apart, with no folder names; the thread's rows open their pickers", async () => {
  const thread = sessionThread(Date.now());
  render(
    createHost([
      {
        ...thread,
        // The agent works in a worktree of the repository.
        checkout: "/test/worktrees/week-view-tree",
        branch: "week-view",
        linked: true,
      },
    ]),
  );
  await openThread();
  await expect.poll(shown).toBe("rev-a-target");
  // The thread shows its review's place; the agent's branch is its own row.
  const place = page.getByRole("region", { name: "Thread" });
  const agent = page.getByRole("region", { name: "Agent" });
  const branch = place.getByRole("button", { name: "main. Show another branch or worktree" });
  await expect.element(branch).toBeVisible();
  await expect.element(agent).toMatchTextContent("week-view");
  expect(place.element().textContent).not.toContain("week-view");
  for (const region of [place, agent]) {
    expect(region.element().textContent).not.toContain("week-view-tree");
    expect(region.element().textContent).not.toContain("worktrees");
  }
  await place.getByRole("button", { name: /\. Show another repository$/ }).click();
  await expect.element(page.getByRole("dialog", { name: "Open repository" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await branch.click();
  await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
});

test("a branch picked in a thread shows in the thread, and the Agent row leads back, also from a branch that Git shows", async () => {
  const host = createHost([sessionThread(Date.now())]);
  render(host);
  await openThread();
  await expect.poll(shown).toBe("rev-a-target");
  const at = location.pathname;
  const place = page.getByRole("region", { name: "Thread" });
  const agent = page.getByRole("region", { name: "Agent" });
  const back = agent.getByRole("button", { name: "main. Show the agent's branch" });
  // The review is in the agent's checkout: nothing to lead back from.
  await expect.element(agent).toMatchTextContent("main");
  expect(back.elements()).toHaveLength(0);
  const pick = async (name: string) => {
    await place.getByRole("button", { name: /\. Show another branch or worktree$/ }).click();
    await page.getByRole("combobox", { name: "Search branches" }).fill(name);
    await userEvent.keyboard("{Enter}");
  };
  // A branch with a worktree: its Changes show here, in no other workspace,
  // and they are not the review's.
  await pick("durations");
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  expect(location.pathname).toBe(at);
  await expect.element(place).toMatchTextContent("durations");
  await expect.element(pages().getByRole("radio", { name: "Changes" })).toBeChecked();
  await expect.element(page.getByRole("heading", { name: "Changes", level: 2 })).toBeVisible();
  await expect.element(agent).toMatchTextContent("main");
  // A branch with no checkout shows from Git, in the agent's own folder. At
  // its base's commit it has no commits of its own, so it shows its newest
  // one, not an empty page. The Agent row still leads back to the agent's
  // branch.
  await pick("release");
  await expect.element(place).toMatchTextContent("release");
  await expect
    .poll(() => host.reviews.at(-1))
    .toEqual({ repo: "/test/repo", comparison: { kind: "commit", commit: head } });
  expect(location.pathname).toBe(at);
  await back.click();
  await expect.element(place).toMatchTextContent("main");
  await expect
    .poll(() => host.reviews.at(-1))
    .toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
  await expect.poll(() => back.elements().length).toBe(0);
  // The review leads again, with its name.
  await pages().getByRole("radio", { name: "Review" }).click();
  await expect.poll(shown).toBe("rev-a-target");
  await expect
    .element(page.getByRole("heading", { name: "Changes", level: 2 }))
    .not.toBeInTheDocument();
});

test("Add a pull request… on a thread with no review shows the review, before the thread list has it", async () => {
  const now = Date.now();
  const thread = { ...sessionThread(now), reviews: [] };
  const host = createHost([thread]);
  render(host);
  await openThread();
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Add a pull request");
  await userEvent.keyboard("{Enter}");
  await page.getByRole("textbox", { name: "Add a pull request" }).fill(PULL_URL);
  await expect.element(page.getByRole("button", { name: /Add pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => host.pulls).toEqual([{ url: PULL_URL, thread: "claude-s1" }]);
  await expect
    .element(page.getByRole("region", { name: "Opening the pull request" }))
    .toBeVisible();
  // The job ends first; the thread list names the review later.
  host.setPull({ status: "done", reviewId: "pull" });
  await expect.poll(shown).toBe("pull-target");
  await expect.element(pages().getByRole("radio", { name: "Review" })).toBeChecked();
  host.setThreads([{ ...thread, reviews: [pullReview(Date.now(), "open")] }]);
  await expect.poll(shown).toBe("pull-target");
  expect(sessionShown()).toBe(true);
  expect(location.pathname).toBe("/review/claude-s1");
});

test("Add a pull request… adds it to the thread as one more review; a link that the thread has shows that review", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const host = createHost([thread]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  const pulls = page.getByRole("region", { name: "Pull requests" });
  await expect.poll(shown).toBe("rev-a-target");
  /** The workspaces that the window has mounted. */
  const slots = () => document.querySelectorAll("[data-workspace-slot]").length;
  const open = slots();
  const add = async (link: string) => {
    await userEvent.keyboard("{Control>}k{/Control}");
    await page.getByRole("combobox", { name: "Search commands" }).fill("Add a pull request");
    await userEvent.keyboard("{Enter}");
    const field = page.getByRole("textbox", { name: "Add a pull request" });
    await expect.element(field).toBeVisible();
    return { field, fill: () => field.fill(link) };
  };

  // Text that names no pull request gives nothing to run.
  const first = await add(`${PULL_URL}/files`);
  await first.field.fill("durations");
  await expect.element(page.getByText(/^Paste a GitHub pull request link/)).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(host.pulls).toEqual([]);
  // A link from the Files tab names the pull request. The host gets it for
  // this thread, and no workspace opens for it.
  await first.fill();
  await expect.element(page.getByRole("button", { name: /Add pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => host.pulls).toEqual([{ url: PULL_URL, thread: "claude-s1" }]);
  expect(slots()).toBe(open);
  expect(location.pathname).toBe("/review/claude-s1");
  // Its steps show where the review shows next, as a pull request's workspace
  // shows them. A failed step says why, and Retry asks the host again.
  const progress = page.getByRole("region", { name: "Opening the pull request" });
  await expect.element(progress).toBeVisible();
  host.setPull({
    status: "failed",
    error: "Add a clone of acme/tide to Med, then open the link again.",
    steps: [{ id: "repository", label: "Find acme/tide", state: "failed" }],
  });
  await expect
    .element(progress.getByRole("alert"))
    .toMatchTextContent("Add a clone of acme/tide to Med, then open the link again.");
  await progress.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => host.pulls.length).toBe(2);
  expect(host.pulls[1]).toEqual({ url: PULL_URL, thread: "claude-s1" });

  // The host saved the review in the thread: it shows, in the thread's
  // workspace, at its own place, and the list has it.
  host.setThreads([{ ...thread, reviews: [pullReview(Date.now(), "open"), ...thread.reviews] }]);
  host.setPull({ status: "done", reviewId: "pull" });
  await expect.poll(shown).toBe("pull-target");
  await expect.element(progress).not.toBeInTheDocument();
  expect(slots()).toBe(open);
  expect(location.pathname).toBe("/review/claude-s1");
  expect(sessionShown()).toBe(true);
  await expect
    .element(pulls.getByRole("button", { name: /^Add durations/ }))
    // The state is the thread list's, then the page's own read of GitHub.
    .toHaveAccessibleName(/^Add durations\. Pull request #7, (open|merged)$/);

  // The same link again asks the host nothing: its review shows.
  await reviews.getByRole("button", { name: /^Week view/ }).click();
  await expect.poll(shown).toBe("rev-a-target");
  const again = await add(PULL_URL);
  await again.fill();
  await userEvent.keyboard("{Enter}");
  await expect.poll(shown).toBe("pull-target");
  expect(host.pulls.length).toBe(2);
});

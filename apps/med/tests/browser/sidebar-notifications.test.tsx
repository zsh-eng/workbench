import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Thread } from "../../src/shared/threads";
import { resetCommentReadsCache } from "../../src/web/data/comment-reads";
import { resetNotificationReadsCache } from "../../src/web/data/notifications";
import type { ReadState } from "../../src/web/data/tabs";
import { SessionSidebar } from "../../src/web/components/shell/SessionSidebar";
import { initializeTheme } from "../../src/web/themes";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  resetNotificationReadsCache();
  resetCommentReadsCache();
  initializeTheme();
  container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;width:260px;";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
});

function makeThread(overrides: Partial<Thread>): Thread {
  return {
    id: "t-1",
    kind: "session",
    title: "Refactor streaming cache",
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    updatedAt: Date.now() - 120_000,
    repository: { id: "r1", name: "trailhead", path: "/repos/trailhead" },
    branch: "main",
    agent: "claude",
    state: "idle",
    reviews: [],
    changes: { files: 2, additions: 28, deletions: 6 },
    turn: { said: "Normalized cache keys and added coverage." },
    ...overrides,
  };
}

test("clicking Notifications switches the sidebar itself to a quiet feed, opens items in place, and supports read/dismiss actions", async () => {
  await page.viewport(1280, 860);
  const now = Date.now();
  const asking = makeThread({
    id: "t-ask",
    title: "Fix LaTeX delimiters",
    updatedAt: now - 60_000,
    state: "waiting",
    turn: { asks: true, said: "Enable single-dollar math in PR descriptions?" },
  });
  const replied = makeThread({
    id: "t-reply",
    title: "Add Markdown Cmd+F",
    updatedAt: now - 240_000,
    reviews: [
      {
        id: "r_111111111111111111111111",
        title: "Markdown find review",
        createdAt: new Date(now - 300_000).toISOString(),
        updatedAt: now - 240_000,
        unread: true,
      },
    ],
  });
  const workingWithUnreadReview = makeThread({
    id: "t-working",
    title: "Active background run",
    updatedAt: now - 30_000,
    state: "working",
    reviews: [
      {
        id: "r_222222222222222222222222",
        title: "Draft review",
        createdAt: new Date(now - 100_000).toISOString(),
        updatedAt: now - 30_000,
        unread: true,
      },
    ],
  });

  const openedThreads: string[] = [];
  const openedPulls: string[] = [];
  const markedReviewReadUrls: string[] = [];

  function Harness() {
    const [threads, setThreads] = useState<Thread[]>([asking, replied, workingWithUnreadReview]);
    const [unreadIds, setUnreadIds] = useState<Set<string>>(() => new Set([replied.id]));

    const read: ReadState = {
      isUnread: (t) => unreadIds.has(t.id),
      setUnread: (t, next) => {
        setUnreadIds((prev) => {
          const copy = new Set(prev);
          if (next) copy.add(t.id);
          else copy.delete(t.id);
          return copy;
        });
      },
      isSubagentUnread: () => false,
      seeSubagent: () => {},
    };

    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/api/reviews/") && url.endsWith("/read") && init?.method === "POST") {
        markedReviewReadUrls.push(url);
        const match = /\/api\/reviews\/([^/]+)\/read$/.exec(url);
        const reviewId = match?.[1];
        if (reviewId) {
          setThreads((prev) =>
            prev.map((thread) => ({
              ...thread,
              reviews: thread.reviews.map((review) =>
                review.id === reviewId ? { ...review, unread: undefined } : review,
              ),
            })),
          );
        }
        return new Response("{}", { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/notifications/comments")) {
        return new Response(
          JSON.stringify({
            replies: [
              {
                threadId: replied.id,
                threadTitle: replied.title,
                repository: "trailhead",
                branch: "main",
                commentId: "c-1",
                kind: "file",
                path: "apps/med/src/web/components/MarkdownPreview.tsx",
                line: 284,
                question: "Skip hidden MathML?",
                answer: "Yes, dom-find skips .katex-mathml.",
                answeredBy: "Claude",
                answeredAt: new Date(now - 180_000).toISOString(),
                resolved: false,
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/pull-requests")) {
        return new Response(
          JSON.stringify({
            viewer: "you",
            scope: "registered",
            repositories: ["acme/trailhead"],
            waiting: [
              {
                url: "https://github.com/acme/trailhead/pull/418",
                number: 418,
                title: "feat(diff): preserve hunk anchor",
                repository: "acme/trailhead",
                author: "maya",
                createdAt: new Date(now - 7_200_000).toISOString(),
                updatedAt: new Date(now - 300_000).toISOString(),
                draft: false,
                review: "required",
                checks: "pass",
                conflicts: false,
                additions: 120,
                deletions: 35,
                why: "review requested",
              },
            ],
            yours: [],
            readAt: new Date(now).toISOString(),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    };

    return (
      <SessionSidebar
        threads={threads}
        current={replied.id}
        read={read}
        loaded
        newThread={false}
        renaming={null}
        fetcher={fetcher}
        onOpen={(thread) => openedThreads.push(thread.id)}
        onOpenPull={(url) => openedPulls.push(url)}
        onNewThread={() => {}}
        onHide={() => {}}
        onSettings={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onPrefetch={() => {}}
        onRenaming={() => {}}
        onRename={() => {}}
        onPin={() => {}}
        onLater={() => {}}
      />
    );
  }

  root!.render(<Harness />);

  // Bell label counts only asking + replied (not the working thread with an unread review).
  await expect.element(page.getByRole("button", { name: "Notifications, 2 unread" })).toBeVisible();

  // Switch the sidebar itself to Notifications.
  await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
  await expect.element(page.getByText("4 unread")).toBeVisible();
  await expect
    .element(page.getByText("Enable single-dollar math in PR descriptions?"))
    .toBeVisible();
  await expect.element(page.getByText("MarkdownPreview.tsx:284")).toBeVisible();
  await expect.element(page.getByText("feat(diff): preserve hunk anchor")).toBeVisible();

  // Only one notification row carries aria-current="page" even when a thread also has a comment reply.
  expect(container!.querySelectorAll('[aria-current="page"]').length).toBe(1);

  // Clicking a PR opens it beside the sidebar and marks it read; clicking a comment reply opens its owning thread.
  await page.getByText("feat(diff): preserve hunk anchor").click();
  expect(openedPulls).toEqual(["https://github.com/acme/trailhead/pull/418"]);
  await page.getByText("MarkdownPreview.tsx:284").click();
  expect(openedThreads).toEqual(["t-reply"]);

  // Row menu toggles unread and dismisses rows cleanly.
  await page
    .getByRole("button", { name: "Notification actions for feat(diff): preserve hunk anchor" })
    .click();
  await page.getByRole("menuitem", { name: "Mark as unread" }).click();
  await expect.element(page.getByText("3 unread")).toBeVisible();

  // Mark all read clears thread + review + PR unread states while leaving Needs you active.
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect.element(page.getByText("1 unread")).toBeVisible();
  expect(markedReviewReadUrls).toEqual(["/api/reviews/r_111111111111111111111111/read"]);

  // Dismissing a row removes it from the list.
  await page
    .getByRole("button", { name: "Notification actions for feat(diff): preserve hunk anchor" })
    .click();
  await page.getByRole("menuitem", { name: "Dismiss" }).click();
  await expect.element(page.getByText("feat(diff): preserve hunk anchor")).not.toBeInTheDocument();

  // Clicking Notifications again returns to the Threads sidebar.
  await page.getByRole("button", { name: "Notifications, active" }).click();
  await expect.element(page.getByRole("heading", { name: "Recent" })).toBeVisible();
});

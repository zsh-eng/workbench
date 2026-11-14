import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { CommentsButton } from "../../src/web/components/CommentsPanel";
import type { ListedComment } from "../../src/web/data/listed-comments";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

const comment = (id: string, change: Partial<ListedComment> = {}): ListedComment => ({
  id,
  kind: "diff",
  path: "src/trails/list.ts",
  line: 12,
  text: `Comment ${id}`,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  replies: 0,
  resolved: false,
  unsent: false,
  ...change,
});

test("All comments shows the open ones' count, lists them, shows resolved on request, and opens one", async () => {
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  const onOpen = vi.fn<(comment: ListedComment) => void>();
  const onCopy = vi.fn<() => Promise<boolean>>(async () => true);
  root = createRoot(mount);
  root.render(
    <CommentsButton
      comments={[
        comment("a", { endLine: 14, unsent: true }),
        comment("b", {
          kind: "file",
          path: "docs/guide.md",
          line: 3,
          replies: 1,
          answeredBy: "Claude",
        }),
        comment("c", { resolved: true }),
      ]}
      onOpen={onOpen}
      onCopy={onCopy}
    />,
  );
  const button = page.getByRole("button", { name: "All comments" });
  await expect.element(button).toHaveTextContent("2");
  await button.click();
  const list = page.getByRole("list", { name: "Comments" });
  await expect.element(list).toBeVisible();
  await expect.poll(() => list.getByRole("listitem").elements().length).toBe(2);
  await expect.element(list.getByText("list.ts L12–14")).toBeVisible();
  await expect.element(list.getByLabelText("Not sent")).toBeVisible();
  await expect.element(list.getByText("guide.md L3")).toBeVisible();
  await expect.element(list.getByText("Claude")).toBeVisible();

  // The filter shows the resolved one too.
  await page.getByRole("button", { name: "Show resolved" }).click();
  await expect.poll(() => list.getByRole("listitem").elements().length).toBe(3);
  await expect.element(list.getByText("Resolved")).toBeVisible();

  await page.getByRole("button", { name: "Copy comments" }).click();
  expect(onCopy).toHaveBeenCalledOnce();

  // A comment opens at its lines, and the panel closes.
  await list.getByRole("button", { name: /Comment b/ }).click();
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "b", kind: "file" }));
  await expect.element(list).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
});

test("Copy comments shows a check once copied, and a failed copy closes the panel so its error shows", async () => {
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const show = (onCopy: () => Promise<boolean>, copied: boolean) =>
    root!.render(
      <CommentsButton
        comments={[comment("a")]}
        onOpen={() => {}}
        onCopy={onCopy}
        copied={copied}
      />,
    );
  show(async () => true, false);
  await page.getByRole("button", { name: "All comments" }).click();
  const list = page.getByRole("list", { name: "Comments" });
  const copy = page.getByRole("button", { name: "Copy comments" });
  await copy.click();
  await expect.element(list).toBeVisible();
  show(async () => true, true);
  await expect.element(copy).toHaveAttribute("data-copied", "true");
  show(async () => false, false);
  await copy.click();
  await expect.element(list).not.toBeInTheDocument();
});

test("A new answer has a dot, on the button and on its comment, with the answer, until it is read", async () => {
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const onRead = vi.fn<(comments: readonly ListedComment[]) => void>();
  root.render(
    <CommentsButton
      comments={[
        comment("a", {
          replies: 1,
          answeredBy: "Claude",
          answer: "Renamed to tidesAt.",
          answeredAt: new Date().toISOString(),
          unread: true,
        }),
        comment("b"),
      ]}
      onOpen={() => {}}
      onRead={onRead}
    />,
  );
  await expect.element(page.getByLabelText("1 new answer")).toBeInTheDocument();
  await page.getByRole("button", { name: "All comments" }).click();
  const list = page.getByRole("list", { name: "Comments" });
  await expect.element(list.getByLabelText("New answer")).toBeVisible();
  await expect.element(list.getByText(/Renamed to tidesAt/)).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  expect(onRead).toHaveBeenCalledWith([expect.objectContaining({ id: "a" })]);
  await userEvent.keyboard("{Escape}");
});

import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { FileDiff } from "@pierre/diffs/react";
import { parsePatchFiles } from "@pierre/diffs";
import { NoteCard, NoteComposer } from "../../src/web/components/NoteCard";
import type { Note, NoteInput, NoteMutation } from "../../src/shared/protocol";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});
function render(element: React.ReactNode) {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
const target = { path: "review.ts", side: "new" as const, line: 1557, endLine: 1560 };
const note: Note = {
  ...target,
  id: "parent",
  text: "Review the return value",
  createdAt: "2026-09-19T00:00:00Z",
  updatedAt: "2026-09-19T00:00:00Z",
  resolution: "active",
};

test("comment keyboard save retains failed text and blocks repeated submission", async () => {
  let attempts = 0;
  let finish: (() => void) | undefined;
  let cancelled = 0;
  const saved: NoteInput[] = [];
  render(
    <NoteComposer
      target={target}
      onCancel={() => cancelled++}
      onSave={async (value) => {
        attempts++;
        saved.push(value);
        if (attempts === 1) throw new Error("Storage unavailable");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }}
    />,
  );
  await expect
    .element(page.getByRole("form", { name: "Local comment on lines R1557 to R1560", exact: true }))
    .toBeVisible();
  await page.getByRole("textbox", { name: "Review note text" }).fill("Keep this feedback");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Storage unavailable");
  await expect
    .element(page.getByRole("textbox", { name: "Review note text" }))
    .toHaveValue("Keep this feedback");
  const textarea = document.querySelector("textarea")!;
  for (let index = 0; index < 3; index++)
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
  expect(attempts).toBe(2);
  expect(saved[1]).toEqual({ ...target, text: "Keep this feedback" });
  finish?.();
  await expect.poll(() => cancelled).toBe(1);
});

test("thread controls edit, reply, edit a reply, delete and cancel with Escape", async () => {
  const mutations: NoteMutation[] = [];
  function Thread() {
    const [parent, setParent] = useState<Note | null>(note);
    const [replies, setReplies] = useState<Note[]>([]);
    const mutate = async (mutation: NoteMutation) => {
      mutations.push(mutation);
      if (mutation.type === "edit") {
        if (mutation.id === note.id)
          setParent((current) => (current ? { ...current, text: mutation.text } : null));
        else
          setReplies((current) =>
            current.map((reply) =>
              reply.id === mutation.id ? { ...reply, text: mutation.text } : reply,
            ),
          );
      }
      if (mutation.type === "add")
        setReplies((current) => [...current, { ...note, ...mutation.note, id: "reply" }]);
      if (mutation.type === "remove") {
        if (mutation.id === note.id) setParent(null);
        else setReplies((current) => current.filter((reply) => reply.id !== mutation.id));
      }
    };
    return parent ? (
      <NoteCard note={parent} replies={replies} onMutate={mutate} />
    ) : (
      <p>Thread removed</p>
    );
  }
  render(<Thread />);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit note text" }).fill("Return value checked");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(page.getByText("Return value checked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply text" }).fill("Agreed");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  expect(mutations.at(-1)).toMatchObject({
    type: "add",
    note: { parentId: note.id, text: "Agreed" },
  });
  await page.getByRole("button", { name: "Edit reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit reply text" }).fill("Agreed, test added");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(page.getByText("Agreed, test added", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete reply", exact: true }).click();
  await expect
    .element(page.getByText("Agreed, test added", { exact: true }))
    .not.toBeInTheDocument();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  document
    .querySelector("textarea")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await expect.element(page.getByRole("textbox", { name: "Reply text" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Delete review note", exact: true }).click();
  await expect.element(page.getByText("Thread removed", { exact: true })).toBeVisible();
});

test("Pierre gutter comment action does not cover a four-digit line number", async () => {
  const fileDiff = parsePatchFiles(
    "diff --git a/review.ts b/review.ts\n--- a/review.ts\n+++ b/review.ts\n@@ -1556,2 +1556,2 @@\n const context = 1;\n-const oldValue = 0;\n+const newValue = 1;\n",
  )[0].files[0];
  let clicked = 0;
  render(
    <FileDiff
      fileDiff={fileDiff}
      options={{
        enableGutterUtility: true,
        diffStyle: "split",
        themeType: "dark",
        unsafeCSS: "[data-utility-button]::before { inset: 0; }",
        onGutterUtilityClick: () => {
          clicked++;
        },
        onLineEnter({ numberElement }) {
          (numberElement.getRootNode() as ShadowRoot)
            .querySelector("[data-utility-button]")
            ?.setAttribute("aria-label", "Add note to line");
        },
      }}
    />,
  );
  await page.getByText("newValue", { exact: true }).hover();
  await expect.element(page.getByRole("button", { name: "Add note to line" })).toBeVisible();
  const host = document.querySelector("diffs-container")!;
  const line = host.shadowRoot!.querySelector(
    '[data-additions] [data-column-number][data-line-type="change-addition"] [data-line-number-content]',
  )!;
  const button = host.shadowRoot!.querySelector<HTMLButtonElement>(
    '[aria-label="Add note to line"]',
  )!;
  expect(line.textContent).toBe("1557");
  expect(button.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    line.getBoundingClientRect().right - 1,
  );
  await page.getByRole("button", { name: "Add note to line" }).click();
  expect(clicked).toBe(1);
});

test("comment cards keep their height when saving and editing wrapped text", async () => {
  function Comment() {
    const [saved, setSaved] = useState<Note | null>(null);
    return saved ? (
      <NoteCard
        note={saved}
        replies={[]}
        onMutate={async (mutation) => {
          if (mutation.type === "edit") setSaved({ ...saved, text: mutation.text });
        }}
      />
    ) : (
      <NoteComposer
        target={target}
        onSave={async (input) => setSaved({ ...note, ...input })}
        onCancel={() => {}}
      />
    );
  }
  render(<Comment />);
  mount!.style.width = "480px";
  const text =
    "Keep the repository and selected range with each comment. ".repeat(5) +
    "\nInclude the captured source, too.";
  await page.getByRole("textbox", { name: "Review note text" }).fill(text);
  const draftHeight = mount!.getBoundingClientRect().height;
  const input = mount!.querySelector("textarea")!;
  expect(input.scrollHeight).toBeLessThanOrEqual(input.clientHeight + 1);
  await page.getByRole("button", { name: "Save note" }).click();
  await expect.element(page.getByRole("article")).toBeVisible();
  expect(Math.abs(mount!.getBoundingClientRect().height - draftHeight)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Edit note text" })).toHaveValue(text);
  expect(Math.abs(mount!.getBoundingClientRect().height - draftHeight)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(Math.abs(mount!.getBoundingClientRect().height - draftHeight)).toBeLessThanOrEqual(1);
});

test("a saved reply replaces its composer while the save promise is still pending", async () => {
  let finish: (() => void) | undefined;
  function Thread() {
    const [replies, setReplies] = useState<Note[]>([]);
    return (
      <NoteCard
        note={note}
        replies={replies}
        onMutate={async (mutation) => {
          if (mutation.type !== "add") return;
          setReplies([{ ...note, ...mutation.note, id: "reply" }]);
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }}
      />
    );
  }
  render(<Thread />);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply text" }).fill("Keep this reply");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Reply text" })).not.toBeInTheDocument();
  await expect.element(page.getByText("Keep this reply", { exact: true })).toBeVisible();
  finish?.();
  await expect.element(page.getByRole("button", { name: "Reply", exact: true })).toBeVisible();
});

test("failed optimistic edits reopen the submitted text and failed deletes restore the card", async () => {
  let fail: ((error: Error) => void) | undefined;
  function Thread() {
    const [parent, setParent] = useState<Note | null>(note);
    const [error, setError] = useState("");
    return (
      <>
        {error && <p role="status">{error}</p>}
        {parent && (
          <NoteCard
            note={parent}
            replies={[]}
            onMutate={async (mutation) => {
              if (mutation.type === "edit") setParent({ ...note, text: mutation.text });
              if (mutation.type === "remove") setParent(null);
              try {
                await new Promise<void>((_resolve, reject) => {
                  fail = reject;
                });
              } catch (cause) {
                setParent(note);
                setError("Could not persist comment");
                throw cause;
              }
            }}
          />
        )}
      </>
    );
  }
  render(<Thread />);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Edit note text" }).fill("Keep this revision");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(page.getByRole("textbox", { name: "Edit note text" }))
    .not.toBeInTheDocument();
  await expect.element(page.getByText("Keep this revision", { exact: true })).toBeVisible();
  fail?.(new Error("Storage unavailable"));
  await expect
    .element(page.getByRole("textbox", { name: "Edit note text" }))
    .toHaveValue("Keep this revision");
  await expect.element(page.getByRole("alert")).toHaveTextContent("Storage unavailable");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Delete review note" }).click();
  await expect.element(page.getByRole("article")).not.toBeInTheDocument();
  fail?.(new Error("Storage unavailable"));
  await expect.element(page.getByRole("article")).toBeVisible();
  await expect.element(page.getByText(note.text, { exact: true })).toBeVisible();
});

test("failed optimistic replies reopen their text without blocking a newer reply", async () => {
  let fail: ((error: Error) => void) | undefined;
  function Thread() {
    const [replies, setReplies] = useState<Note[]>([]);
    return (
      <NoteCard
        note={note}
        replies={replies}
        onMutate={async (mutation) => {
          if (mutation.type !== "add") return;
          setReplies([{ ...note, ...mutation.note, id: "reply" }]);
          try {
            await new Promise<void>((_resolve, reject) => {
              fail = reject;
            });
          } catch (cause) {
            setReplies([]);
            throw cause;
          }
        }}
      />
    );
  }
  render(<Thread />);
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply text" }).fill("Keep the failed reply");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Reply text" })).not.toBeInTheDocument();
  fail?.(new Error("Storage unavailable"));
  await expect
    .element(page.getByRole("textbox", { name: "Reply text" }))
    .toHaveValue("Keep the failed reply");
  await expect.element(page.getByRole("alert")).toHaveTextContent("Storage unavailable");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "Reply text" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByRole("textbox", { name: "Reply text" }).fill("A newer reply draft");
  fail?.(new Error("Storage unavailable"));
  await expect
    .element(page.getByRole("textbox", { name: "Reply text" }))
    .toHaveValue("A newer reply draft");
});

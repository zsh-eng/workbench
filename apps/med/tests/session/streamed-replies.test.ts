import { expect, test } from "vitest";
import { finishedBlocks } from "../../src/web/components/session/streamed-replies";
import { createSessionStore } from "../../src/web/data/session-store";
import { applyOwnedStreamEvent, type OwnedState } from "../../src/shared/owned-session";

test("a streaming reply shows up to its last finished block", () => {
  // The first paragraph is still arriving.
  expect(finishedBlocks("I traced the slow sea")).toBe("");
  expect(finishedBlocks("I traced the slow search.\n")).toBe("");
  // A blank line ends it.
  expect(finishedBlocks("I traced the slow search.\n\nThe filt")).toBe("I traced the slow search.");
  // A heading ends at its line.
  expect(finishedBlocks("One.\n\n## What changes\nThe filters now")).toBe(
    "One.\n\n## What changes",
  );
  // A list waits for its blank line, so it shows whole.
  expect(finishedBlocks("One.\n\n- `matchesFilters` moves.\n- `searchTr")).toBe("One.");
  expect(finishedBlocks("- a\n- b\n\nNext")).toBe("- a\n- b");
});

test("a code block shows once its fence closes, blank lines and all", () => {
  const open = "Here it is:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n";
  expect(finishedBlocks(open)).toBe("Here it is:");
  // The closing fence is still arriving.
  expect(finishedBlocks(`${open}\`\``)).toBe("Here it is:");
  expect(finishedBlocks(`${open}\`\`\`\n`)).toBe(`${open}\`\`\``);
  // A shorter fence, or another marker, does not close it.
  expect(finishedBlocks("````md\n```\n~~~\n")).toBe("");
  expect(finishedBlocks("````md\n```\n````\nAfter")).toBe("````md\n```\n````");
  // A fence in a list item, indented.
  expect(finishedBlocks("- Run:\n\n  ```sh\n  bun test\n  ```\n")).toBe(
    "- Run:\n\n  ```sh\n  bun test\n  ```",
  );
  // A heading-like line inside a fence is code.
  expect(finishedBlocks("```sh\n# install\n")).toBe("");
});

test("session store prepend preserves unchanged item references while merging orphaned tool updates", () => {
  const store = createSessionStore();
  store.applyAll([
    // Orphaned result whose tool_call lives on an earlier page.
    {
      at: 2000,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "ok" } }],
      },
    },
    {
      at: 3000,
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "u2",
        content: { type: "text", text: "Second prompt" },
      },
    },
    {
      at: 4000,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "a2",
        content: { type: "text", text: "Second reply" },
      },
    },
  ]);
  const before = store.getSnapshot().items;
  expect(before).toHaveLength(2);
  const [userBefore, replyBefore] = before;

  store.prepend([
    {
      at: 1000,
      update: {
        sessionUpdate: "user_message_chunk",
        messageId: "u1",
        content: { type: "text", text: "First prompt" },
      },
    },
    {
      at: 1500,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Read file",
        kind: "read",
        status: "in_progress",
      },
    },
  ]);
  const after = store.getSnapshot().items;
  expect(after).toHaveLength(4);
  // Newly prepended call adopted its waiting result from the tail.
  expect(after[1]).toMatchObject({
    kind: "tool",
    id: "call-1",
    call: { title: "Read file", status: "completed" },
  });
  // Unchanged items from the tail keep strict reference identity.
  expect(after[2]).toBe(userBefore);
  expect(after[3]).toBe(replyBefore);
});

test("applyOwnedStreamEvent patches streaming deltas without altering unrelated state", () => {
  const initial: OwnedState = {
    sessionId: "s1",
    preset: "claude",
    name: "Claude Code",
    status: "working",
    settings: [{ id: "model", name: "Model", category: "model", value: "opus", options: [] }],
    commands: [{ name: "test", description: "Run tests" }],
    turns: 1,
  };
  const first = applyOwnedStreamEvent(initial, {
    event: "streaming",
    data: JSON.stringify({ streaming: { id: "m1", text: "Hello" }, updatedAt: 100 }),
  })!;
  expect(first.streaming).toEqual({ id: "m1", text: "Hello" });
  expect(first.settings).toBe(initial.settings);
  expect(first.commands).toBe(initial.commands);
  const second = applyOwnedStreamEvent(first, {
    event: "streaming",
    data: JSON.stringify({ id: "m1", from: 5, delta: " world.", ended: true, updatedAt: 200 }),
  })!;
  expect(second.streaming).toEqual({ id: "m1", text: "Hello world.", ended: true });
  expect(second.updatedAt).toBe(200);
  // Replaying an overlapping or already-applied delta (e.g. after POST /owned
  // returned a newer snapshot) must be idempotent and never duplicate text.
  const duplicate = applyOwnedStreamEvent(second, {
    event: "streaming",
    data: JSON.stringify({ id: "m1", from: 5, delta: " world.", updatedAt: 200 }),
  })!;
  expect(duplicate.streaming).toEqual({ id: "m1", text: "Hello world.", ended: true });
  const partialOverlap = applyOwnedStreamEvent(second, {
    event: "streaming",
    data: JSON.stringify({ id: "m1", from: 8, delta: "rld. More!", updatedAt: 210 }),
  })!;
  expect(partialOverlap.streaming).toEqual({ id: "m1", text: "Hello world. More!", ended: true });
  const cleared = applyOwnedStreamEvent(second, {
    event: "streaming",
    data: JSON.stringify({ streaming: null }),
  })!;
  expect(cleared.streaming).toBeUndefined();
});

import { expect, test } from "vitest";
import { finishedBlocks } from "../../src/web/components/session/streamed-replies";

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

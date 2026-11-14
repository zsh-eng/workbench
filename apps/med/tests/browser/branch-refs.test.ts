import { expect, test } from "vitest";
import { branchRefOf, createFileIndex, decorateFileRefs } from "../../src/web/data/file-refs";

const index = createFileIndex("/code/tide", [{ path: "src/tides.ts", kind: "file" }]);
const branches = new Set(["main", "agent/tide-rates"]);

test("inline code that names a branch of the repository links to it; a file wins, and other code stays", () => {
  const [block] = decorateFileRefs(
    [
      {
        html: "<p>On <code>agent/tide-rates</code>, from <code>main</code>: <code>src/tides.ts</code>, <code>nope</code>.</p><pre><code>main</code></pre>",
      },
    ],
    index,
    undefined,
    {},
    branches,
  );
  const template = document.createElement("template");
  template.innerHTML = block!.html;
  const links = [...template.content.querySelectorAll("a")];
  expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
    "Show branch agent/tide-rates",
    "Show branch main",
    "Open src/tides.ts",
  ]);
  expect(branchRefOf(links[0]!.querySelector("span")!)).toBe("agent/tide-rates");
  expect(branchRefOf(links[2]!)).toBeNull();
  // Code that names nothing, and code blocks, stay code.
  expect([...template.content.querySelectorAll("code")].map((code) => code.textContent)).toEqual([
    "nope",
    "main",
  ]);
});

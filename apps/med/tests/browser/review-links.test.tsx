import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { HandoffContext } from "../../src/web/components/session/HandoffCard";
import { SessionMarkdown } from "../../src/web/components/session/SessionMarkdown";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;
const start = location.pathname;
afterEach(() => {
  vi.restoreAllMocks();
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
  history.replaceState(null, "", start);
});

function show(text: string) {
  initializeTheme();
  frame = document.createElement("div");
  document.body.append(frame);
  root = createRoot(frame);
  const own = vi.fn<() => void>();
  root.render(
    <HandoffContext.Provider value={{ title: "Own review", open: own, id: "r_own" }}>
      <SessionMarkdown text={text} streaming={false} />
    </HandoffContext.Provider>,
  );
  return own;
}

test("a link to a review of this Med's opens it here, not in a new window", async () => {
  const opened = vi.spyOn(window, "open").mockReturnValue(null);
  const own = show(
    [
      `The fix is in [the review](${location.origin}/review/r_other?from=reply), with tests.`,
      "",
      `[Review changes here](${location.origin}/review/r_own)`,
    ].join("\n"),
  );
  // In a sentence, the link stays a link and opens the review's workspace.
  await page.getByRole("link", { name: "the review" }).click();
  expect(location.pathname).toBe("/review/r_other");
  // On its own line, it is the review's card.
  await page.getByRole("button", { name: "Open the review: Own review" }).click();
  expect(own).toHaveBeenCalledOnce();
  expect(opened).not.toHaveBeenCalled();
});

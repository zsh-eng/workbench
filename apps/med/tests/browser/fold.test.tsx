import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { Fold } from "../../src/web/components/Fold";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
});
function render(element: React.ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => <p key={index}>Line {index + 1}</p>);

test("text taller than half a screen folds there, and the button names the sections left", async () => {
  await page.viewport(800, 600);
  render(
    <Fold>
      <h2>Summary</h2>
      {lines(4)}
      <h2>How it fits</h2>
      {lines(20)}
      <h2>Testing</h2>
      {lines(6)}
      <h2>Rollout</h2>
      {lines(6)}
    </Fold>,
  );
  const more = page.getByRole("button", { name: /^Show more/ });
  await expect.element(more).toHaveTextContent("Show more: Testing, Rollout");
  const box = document.querySelector<HTMLElement>("[data-folded]")!;
  expect(box.getBoundingClientRect().height).toBeLessThanOrEqual(300);
  await more.click();
  await expect.element(page.getByRole("button", { name: "Show less" })).toBeVisible();
  expect(document.querySelector("[data-folded]")).toBeNull();
});

test("short text does not fold", async () => {
  await page.viewport(800, 600);
  render(<Fold>{lines(3)}</Fold>);
  await expect.element(page.getByText("Line 3")).toBeVisible();
  expect(page.getByRole("button").query()).toBeNull();
});

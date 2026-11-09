import { expect, test } from "bun:test";
import { ReviewImagePreloader } from "./preload";
import { renderCard } from "@/lib/markdown/cards";
import { cacheImagesInContainer } from "./cache-container";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("preloads deduplicate shared images, limit work, and release changed windows", async () => {
  const calls: string[] = [],
    released: string[] = [];
  const resolve = new Map<string, (url: string) => void>();
  const loader = new ReviewImagePreloader(
    (url) => {
      calls.push(url);
      return new Promise((yes) => resolve.set(url, yes));
    },
    (url) => released.push(url),
  );
  loader.update(["a", "a", "b", "c", "d", "e"]);
  expect(calls).toEqual(["a", "b", "c", "d"]);
  loader.update(["b", "e"]);
  resolve.get("a")!("blob:a");
  resolve.get("b")!("blob:b");
  resolve.get("c")!("blob:c");
  resolve.get("d")!("blob:d");
  await tick();
  expect(calls).toEqual(["a", "b", "c", "d", "e"]);
  expect(released.sort()).toEqual(["a", "c", "d"]);
  resolve.get("e")!("blob:e");
  await tick();
  loader.dispose();
  expect(released.sort()).toEqual(["a", "b", "c", "d", "e"]);
});
test("review HTML checks the cache before assigning any network image source", async () => {
  const result = await renderCard("![diagram](https://example.test/a.png)");
  const container = document.createElement("div");
  container.innerHTML = result.html;
  document.body.append(container);
  const image = container.querySelector("img")!;
  expect(image.hasAttribute("src")).toBe(false);
  expect(result.images).toEqual(["https://example.test/a.png"]);
  const sources: string[] = [];
  const stop = cacheImagesInContainer(
    container,
    async (url) => {
      sources.push(url);
      return "blob:cached";
    },
    () => {},
  );
  await tick();
  expect(image.getAttribute("src")).toBe("blob:cached");
  expect(sources).toEqual(result.images);
  stop();
  expect(image.hasAttribute("src")).toBe(false);
  container.remove();
});

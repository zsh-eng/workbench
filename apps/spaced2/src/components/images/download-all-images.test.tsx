import { expect, test } from "bun:test";
import { act } from "react";
import { click, render } from "../../../tests/dom";
import type { downloadImagesLocally } from "@/lib/images/db";
import DownloadAllImages from "./download-all-images";

/** A bulk download that settles each image when `each` does. */
const eachImage =
  (
    each: (url: string, signal: AbortSignal) => Promise<{ newlyDownloaded: boolean } | void>,
  ): typeof downloadImagesLocally =>
  async (links, { signal, onSettled }) => {
    await Promise.all(
      links.map(async ([url]) => {
        try {
          const result = await each(url, signal!);
          if (result) onSettled(url, result);
        } catch (error) {
          onSettled(url, { error });
        }
      }),
    );
  };

/** The job publishes its progress on a timer, at most every 100 ms. */
const published = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}

test("batch waits for every image even when its last queued task finishes first", async () => {
  const slow = deferred();
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map([
          ["slow", ""],
          ["fast", ""],
        ])
      }
      download={eachImage(async (url) => {
        if (url === "slow") await slow.promise;
        return { newlyDownloaded: true };
      })}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    await published();
    expect(view.container.textContent).toContain("Downloading (1 / 2)");
    expect(view.container.textContent).not.toContain("Downloaded 2");
    await act(async () => slow.resolve());
    await published();
    expect(view.container.textContent).toContain("Downloaded 2 new images");
  } finally {
    await view.unmount();
  }
});

test("cancel remains terminal while images already arriving settle, and the rest stop", async () => {
  const pending = deferred();
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map(Array.from({ length: 7 }, (_, index) => [`image-${index}`, ""]))
      }
      download={eachImage(async (url, signal) => {
        if (url === "image-0" || url === "image-1")
          return { newlyDownloaded: true };
        await pending.promise;
        // One image was arriving when the cancel came; the others stop.
        if (url === "image-2" || !signal.aborted)
          return { newlyDownloaded: true };
      })}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    await published();
    await click(
      view.container.querySelector(
        'button[aria-label="Cancel image downloads"]',
      )!,
    );
    expect(view.container.textContent).toContain("Download cancelled");
    await act(async () => pending.resolve());
    await published();
    expect(view.container.textContent).toContain("Download cancelled (3 / 7)");
    expect(view.container.textContent).not.toContain("Downloaded");
  } finally {
    await view.unmount();
  }
});

test("a failed batch item is counted and does not reject the whole batch", async () => {
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map([
          ["bad", ""],
          ["good", ""],
        ])
      }
      download={eachImage(async (url) => {
        if (url === "bad") throw new Error("Offline");
        return { newlyDownloaded: true };
      })}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    await published();
    expect(view.container.textContent).toContain(
      "Downloaded 1 new images; 1 failed",
    );
  } finally {
    await view.unmount();
  }
});

test("the download keeps going when you leave the Images page", async () => {
  const pending = deferred();
  let finished = 0;
  const links = () => new Map([["a", ""]]);
  const download = eachImage(async () => {
    await pending.promise;
    finished++;
    return { newlyDownloaded: true };
  });
  const view = await render(
    <DownloadAllImages findLinks={links} download={download} />,
  );
  await click(view.container.querySelector("button")!);
  await published();
  expect(view.container.textContent).toContain("Downloading (0 / 1)");
  await view.unmount();
  await act(async () => pending.resolve());
  await published();
  expect(finished).toBe(1);
});

import { afterEach, expect, test } from "vitest";
import { startSettingsFile } from "../../src/web/data/settings-file";
import { viewSettings } from "../../src/web/data/view-settings";
import { initializeTheme, themeController } from "../../src/web/themes";

const PATH = "/home/trailhead/.config/med/settings.json";
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  for (const key of ["med:wrap", "med:mode", "med:code-size", "med:theme-mode"])
    localStorage.removeItem(key);
});

/** A host with a settings file: its stream, which the test pushes to, and the writes. */
function host(initial: Record<string, unknown>) {
  let settings = { ...initial };
  const writes: unknown[] = [];
  let push: (text: string) => void = () => {};
  const state = () =>
    `event: state\ndata: ${JSON.stringify({ path: PATH, settings, error: null })}\n\n`;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/api/settings/events") {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          push = (text) => controller.enqueue(encoder.encode(text));
          push(state());
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname === "/api/settings" && init?.method === "PUT") {
      const { key, value } = JSON.parse(String(init.body));
      writes.push({ [key]: value });
      settings = { ...settings, [key]: value };
      return Response.json({ path: PATH, settings, error: null });
    }
    return Response.json({ error: { code: "not-found", message: "Not found" } }, { status: 404 });
  };
  return {
    fetcher: fetcher as typeof fetch,
    writes,
    /** An agent saves the file. */
    save(next: Record<string, unknown>) {
      settings = next;
      push(state());
    },
  };
}

test("a choice from before the file goes to it once, and the reader's choices follow", async () => {
  localStorage.setItem("med:wrap", "on");
  const file = host({ "diffs.layout": "split" });
  stop = startSettingsFile(file.fetcher);
  // Other files' tests share this storage, so their settings may go too.
  await expect.poll(() => file.writes).toContainEqual({ "diffs.wrap": true });
  expect(file.writes.filter((write) => "diffs.wrap" in (write as object))).toHaveLength(1);
  expect(file.writes.some((write) => "diffs.layout" in (write as object))).toBe(false);
  viewSettings.codeSize.set("14");
  await expect.poll(() => file.writes).toContainEqual({ "code.textSize": 14 });
  // A setting the file already holds is not written again.
  viewSettings.diffLayout.set("split");
  expect(file.writes).not.toContainEqual({ "diffs.layout": "split" });
});

test("an agent's save of the file applies at once, the theme too", async () => {
  initializeTheme();
  const file = host({});
  stop = startSettingsFile(file.fetcher);
  file.save({ "diffs.layout": "unified", "appearance.theme": "light", "diffs.wrap": "maybe" });
  await expect.poll(() => viewSettings.diffLayout.get()).toBe("unified");
  await expect.poll(() => themeController.getSnapshot().mode).toBe("light");
  // A value that the key does not take changes nothing.
  expect(viewSettings.wrap.get()).toBe("off");
});

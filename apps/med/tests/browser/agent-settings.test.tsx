import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { AgentSettings } from "../../src/web/components/settings/AgentSettings";
import { startSettingsFile } from "../../src/web/data/settings-file";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  root?.unmount();
  mount?.remove();
  root = mount = stop = undefined;
  vi.restoreAllMocks();
});

test("Settings › Agents sets where each agent installed here compacts, and Default takes its key out", async () => {
  initializeTheme();
  const writes: { key: string; value: unknown }[] = [];
  // A value from the file, which Settings has no choice for, shows as it is.
  let settings: Record<string, unknown> = { "codex.autoCompact": 237_000 };
  let push: (text: string) => void = () => {};
  const state = () =>
    `event: state\ndata: ${JSON.stringify({ path: "/tmp/med/settings.json", settings, error: null })}\n\n`;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
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
    if (url.pathname === "/api/agents")
      return Response.json({
        agents: [
          { id: "claude", name: "Claude Code", kind: "claude", available: true },
          { id: "codex", name: "Codex", kind: "codex", available: true },
          { id: "pi", name: "Pi", kind: "pi", available: true },
          { id: "agy", name: "Antigravity", kind: "agy", available: false },
          { id: "opencode", name: "OpenCode", kind: "acp", available: true },
        ],
      });
    if (url.pathname === "/api/settings" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { key: string; value: unknown };
      writes.push(body);
      const { [body.key]: _old, ...rest } = settings;
      settings = body.value === null ? rest : { ...settings, [body.key]: body.value };
      push(state());
      return Response.json({ path: "/tmp/med/settings.json", settings, error: null });
    }
    return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
  });
  stop = startSettingsFile();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<AgentSettings />);

  const section = page.getByRole("region", { name: "Agents", exact: true });
  // The agents installed here whose autocompact Med sets, in Med's order.
  await expect.element(section.getByText("Claude Code", { exact: true })).toBeVisible();
  for (const name of ["Codex", "Pi"])
    await expect.element(section.getByText(name, { exact: true })).toBeVisible();
  expect(section.getByText("Antigravity").query()).toBeNull();
  expect(section.getByText("OpenCode").query()).toBeNull();
  await expect
    .element(section.getByRole("combobox", { name: "Claude Code autocompact" }))
    .toHaveTextContent("Default");
  await expect
    .element(section.getByRole("combobox", { name: "Codex autocompact" }))
    .toHaveTextContent("237k");

  await section.getByRole("combobox", { name: "Pi autocompact" }).click();
  await page.getByRole("option", { name: "200k" }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ key: "pi.autoCompact", value: 200_000 });
  await expect
    .element(section.getByRole("combobox", { name: "Pi autocompact" }))
    .toHaveTextContent("200k");

  // The first list closes before the next opens.
  await expect.poll(() => page.getByRole("option").elements()).toHaveLength(0);
  await section.getByRole("combobox", { name: "Codex autocompact" }).click();
  await page.getByRole("option", { name: "Default" }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ key: "codex.autoCompact", value: null });
  await expect.poll(() => settings).toEqual({ "pi.autoCompact": 200_000 });
});

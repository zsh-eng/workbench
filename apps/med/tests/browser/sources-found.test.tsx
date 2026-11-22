import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SourcesPage, type Source } from "../../src/web/components/SourcesPage";
import { SettingsPage } from "../../src/web/components/settings/SettingsPage";
import { HttpError } from "../../src/web/data/api";
import {
  findSources,
  type Discovery,
  type FoundSource,
  type SetupApi,
} from "../../src/web/data/setup";
import { initializeTheme } from "../../src/web/themes";

const HOME = "/Users/me";
const HOUR = 3_600_000;

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
// The palette's request moves the address to /sources; the files after this one start where it began.
const address = location.pathname + location.search;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  history.replaceState(null, "", address);
});

const repo = (name: string, hours: number, branch = "main"): FoundSource => ({
  path: `${HOME}/code/${name}`,
  name,
  activity: Date.now() - hours * HOUR,
  branch,
});

/** A server's setup: what a search finds, what is registered, and the calls.
 * An add or a search waits while `hold` is set, and an add fails with `fail`. */
function server(found: FoundSource[], vaults: FoundSource[] = []) {
  const host = {
    registered: [] as Source[],
    searches: [] as boolean[],
    adds: [] as string[],
    logins: [] as boolean[],
    login: { available: true, enabled: false },
    hold: undefined as Promise<void> | undefined,
    fail: undefined as Error | undefined,
    /** Without setup, as a foreground review server. */
    absent: false,
  };
  const discovery = (deep: boolean): Discovery => ({
    home: HOME,
    repositories: found,
    vaults,
    skipped: deep ? [] : ["Desktop", "Documents", "Downloads"],
    truncated: false,
  });
  const api: SetupApi = {
    status: async () => {
      if (host.absent) throw new HttpError("This API route does not exist.", 404);
      return { sources: host.registered, login: host.login };
    },
    discover: async (deep) => {
      host.searches.push(deep);
      await host.hold;
      if (host.absent) throw new HttpError("This API route does not exist.", 404);
      return discovery(deep);
    },
    add: async (path, kind = "repo") => {
      host.adds.push(path);
      await host.hold;
      if (host.fail) throw host.fail;
      const name = path.slice(path.lastIndexOf("/") + 1);
      host.registered = [...host.registered, { id: path, name, path, kind }];
    },
    login: async (enabled) => {
      host.logins.push(enabled);
      return (host.login = { available: true, enabled });
    },
  };
  return Object.assign(host, { api });
}
type Server = ReturnType<typeof server>;

/** A gate that an add or a search waits at until the test opens it. */
function gate() {
  let open = () => {};
  const closed = new Promise<void>((done) => (open = done));
  return { closed, open };
}

/** Sources as the app wires it: the list reads the server's sources again
 * when the page asks. */
function Sources({ host }: { host: Server }) {
  const [sources, setSources] = useState(host.registered);
  return (
    <SourcesPage
      sources={sources}
      home={HOME}
      loaded
      setup={host.api}
      onOpenVault={() => {}}
      onRequest={async () => {}}
      onRefresh={async () => setSources(host.registered)}
    />
  );
}

function render(node: ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "position:fixed;inset:0;display:flex;flex-direction:column";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(node);
}

const found = () => page.getByRole("region", { name: "Found on this computer" });
const registered = () => page.getByRole("list", { name: "Sources" });
const names = (list: Element) =>
  [...list.querySelectorAll('[data-row="name"]')].map((node) => node.textContent);

test("with nothing registered Sources opens on what Med found, and Add moves a row to the list above", async () => {
  await page.viewport(1280, 800);
  const host = server(
    [repo("tide", 0.1), repo("atlas", 30, "feature/sync"), repo("old-blog", 9000, "master")],
    [{ path: `${HOME}/Notes`, name: "Notes", activity: Date.now() - 2 * HOUR }],
  );
  const search = gate();
  host.hold = search.closed;
  render(<Sources host={host} />);
  // Until the search answers, the section is one line, and the page keeps the focus where it was.
  await expect.element(found().getByText("Looking in your home folder…")).toBeVisible();
  expect(found().getByRole("textbox").query()).toBeNull();
  expect(document.activeElement).toBe(document.body);
  host.hold = undefined;
  search.open();
  // Most recently active first, repositories and vaults together.
  await expect.poll(() => names(found().element())).toEqual(["tide", "Notes", "atlas", "old-blog"]);
  expect(registered().query()).toBeNull();
  const atlas = found().getByRole("listitem").nth(2);
  await expect.element(atlas).toHaveTextContent("atlas~/codefeature/sync1dAdd");

  // While an add runs, its button waits; then the row is a source.
  const adding = gate();
  host.hold = adding.closed;
  await found().getByRole("button", { name: "Add atlas" }).click();
  const busy = found().getByRole("button", { name: "Adding… atlas" });
  await expect.element(busy).toBeDisabled();
  await expect.element(busy).toHaveTextContent("Adding…");
  expect(names(found().element())).toContain("atlas");
  host.hold = undefined;
  adding.open();
  await expect.poll(() => names(registered().element())).toEqual(["atlas"]);
  expect(names(found().element())).toEqual(["tide", "Notes", "old-blog"]);
  expect(host.adds).toEqual([`${HOME}/code/atlas`]);
  // The row left with the focus; the section keeps the keyboard in the list.
  await expect.element(found()).toHaveFocus();
});

test("a failed add reads Retry and says why once under the list, and Add the N recent takes those used lately", async () => {
  await page.viewport(1280, 800);
  const host = server([repo("tide", 0.1), repo("atlas", 30), repo("old-blog", 9000)]);
  render(<Sources host={host} />);
  await expect.poll(() => names(found().element())).toHaveLength(3);
  host.fail = new Error("This folder is not readable.");
  await found().getByRole("button", { name: "Add tide" }).click();
  await found().getByRole("button", { name: "Add atlas" }).click();
  await expect.element(found().getByRole("button", { name: "Retry tide" })).toBeEnabled();
  await expect.element(found().getByRole("button", { name: "Retry atlas" })).toBeEnabled();
  // One line, for the row that failed last.
  const alert = found().getByRole("alert");
  await expect.element(alert).toHaveTextContent("atlas: This folder is not readable.");
  expect(alert.elements()).toHaveLength(1);

  // The two used in the last three weeks, in turn; the old checkout stays.
  host.fail = undefined;
  host.adds.length = 0;
  await found().getByRole("button", { name: "Add the 2 recent" }).click();
  await expect.poll(() => names(registered().element())).toEqual(["atlas", "tide"]);
  expect(host.adds).toEqual([`${HOME}/code/tide`, `${HOME}/code/atlas`]);
  expect(names(found().element())).toEqual(["old-blog"]);
  expect(found().getByRole("alert").query()).toBeNull();
  expect(
    found()
      .getByRole("button", { name: /recent/ })
      .query(),
  ).toBeNull();
});

test("Add sources… shows and hides the section, searches once, and the palette's request opens it", async () => {
  await page.viewport(1280, 800);
  const many = Array.from({ length: 9 }, (_, at) => repo(`station-${at}`, 800 + at));
  const host = server(many);
  host.registered = [{ id: "a", name: "tide", path: `${HOME}/code/tide`, kind: "repo" }];
  render(<Sources host={host} />);
  const toggle = page.getByRole("button", { name: "Add sources…" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  // A visit to Sources does not search.
  expect(host.searches).toEqual([]);
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await expect.element(found()).toHaveFocus();
  // Six rows, then the rest on request. None is recent, so there is no Add the N recent.
  await expect.poll(() => names(found().element())).toHaveLength(6);
  expect(
    found()
      .getByRole("button", { name: /recent/ })
      .query(),
  ).toBeNull();
  await found().getByRole("button", { name: "Show 3 more" }).click();
  expect(names(found().element())).toHaveLength(9);

  await toggle.click();
  expect(found().query()).toBeNull();
  await toggle.click();
  await expect.poll(() => names(found().element())).toHaveLength(6);
  expect(host.searches).toEqual([false]);

  // The guarded folders, on request.
  const search = gate();
  host.hold = search.closed;
  await found().getByRole("button", { name: "Search them too" }).click();
  await expect.element(found().getByRole("button", { name: "Searching…" })).toBeDisabled();
  host.hold = undefined;
  search.open();
  await expect.element(found().getByText("Not searched")).not.toBeInTheDocument();
  expect(host.searches).toEqual([false, true]);

  // A folder by its path: ~/ is the home folder, and a failure shows under the field.
  const field = found().getByRole("textbox", { name: "Add a folder by path" });
  host.fail = new Error("This folder does not exist.");
  await field.fill("~/nowhere");
  await userEvent.keyboard("{Enter}");
  await expect.element(found().getByRole("alert")).toHaveTextContent("This folder does not exist.");
  host.fail = undefined;
  await field.fill("~/work/atlas");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => names(registered().element())).toEqual(["atlas", "tide"]);
  expect(host.adds).toEqual([`${HOME}/nowhere`, `${HOME}/work/atlas`]);
  await expect.element(field).toHaveValue("");

  // A source added elsewhere, as with the CLI, shows when the window gets focus.
  host.registered = [
    ...host.registered,
    { id: "b", name: "station-0", path: `${HOME}/code/station-0`, kind: "repo" },
  ];
  window.dispatchEvent(new Event("focus"));
  await expect.poll(() => names(registered().element())).toEqual(["atlas", "station-0", "tide"]);
  expect(names(found().element())).not.toContain("station-0");

  // ⌘K's Add sources… asks from anywhere; the address has no query.
  await toggle.click();
  expect(found().query()).toBeNull();
  findSources();
  await expect.element(found()).toHaveFocus();
  expect(location.pathname + location.search).toBe("/sources");
});

test("the section says when nothing is left to find, when nothing was found at all, and when the server cannot add", async () => {
  await page.viewport(1280, 800);
  const tide = repo("tide", 1);
  const host = server([tide]);
  host.registered = [{ id: "a", name: "tide", path: tide.path, kind: "repo" }];
  render(<Sources host={host} />);
  await page.getByRole("button", { name: "Add sources…" }).click();
  await expect
    .element(found().getByText("No other repositories or vaults found in your home folder."))
    .toBeVisible();
  await expect.element(found().getByRole("textbox")).toBeVisible();
  root?.unmount();

  // First run on a computer with nothing to find: one plain line and the terminal's way.
  root = createRoot(mount!);
  root.render(<Sources host={server([])} />);
  await expect
    .element(found().getByText("No repositories or vaults found in your home folder"))
    .toBeVisible();
  await expect.element(found().getByText("med add ~/code/my-app")).toBeVisible();
  root.unmount();

  // A foreground review server has no setup: one line, and no list or field.
  const review = server([tide]);
  review.absent = true;
  review.registered = [{ id: "a", name: "atlas", path: `${HOME}/code/atlas`, kind: "repo" }];
  root = createRoot(mount!);
  root.render(<Sources host={review} />);
  await page.getByRole("button", { name: "Add sources…" }).click();
  await expect
    .element(found())
    .toHaveTextContent(
      "Found on this computerThis server cannot add sources. From a terminal: med add <folder>",
    );
  expect(found().getByRole("list").query()).toBeNull();
  expect(found().getByRole("textbox").query()).toBeNull();
});

test("Settings has Open at login only where the server can set it", async () => {
  const host = server([]);
  render(<SettingsPage setup={host.api} onSources={() => {}} />);
  const sources = page.getByRole("region", { name: "Sources", exact: true });
  const toggle = sources.getByRole("switch", { name: "Open at login" });
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .element(sources.getByText("Review links keep working after a restart."))
    .toBeVisible();
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  expect(host.logins).toEqual([true]);
  root?.unmount();

  const review = server([]);
  review.absent = true;
  root = createRoot(mount!);
  root.render(<SettingsPage setup={review.api} onSources={() => {}} />);
  await expect
    .element(page.getByRole("switch", { name: "Pull base branches" }))
    .toBeInTheDocument();
  expect(page.getByRole("switch", { name: "Open at login" }).query()).toBeNull();
});

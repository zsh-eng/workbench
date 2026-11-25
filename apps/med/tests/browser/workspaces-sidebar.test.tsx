import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { themeController } from "../../src/web/themes";
import {
  branches,
  cleanUp,
  createHost,
  mount,
  prepareWindow,
  render,
  repositories,
  root,
  shown,
  thread,
  threadRows,
  WINDOW_KEY,
} from "./workspaces-fixture";

beforeEach(prepareWindow);
afterEach(cleanUp);

test("a row is the thread's name, without the agent's mark; the Superagent's thread is only its own row, at the top", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  host.setThreads([
    thread("agent", { updatedAt: now - 1000 }),
    thread("boss", { title: "Superagent", superagent: true, updatedAt: now, pinned: 1 }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review"]);
  const agentRow = document.querySelector<HTMLElement>('[data-session-row="agent"] button')!;
  expect(agentRow.querySelector("svg")).toBeNull();
  expect(document.querySelector('section[aria-label="Pinned"]')).toBeNull();
  const superagent = document.querySelector<HTMLElement>(
    'nav[aria-label="Sessions"] button[data-thread="boss"]',
  )!;
  expect(superagent.textContent).toBe("Superagent");
  expect(superagent.hasAttribute("aria-current")).toBe(false);
  // ⌘1 follows the sidebar: the Superagent first.
  await userEvent.keyboard("{Meta>}1{/Meta}");
  await expect.poll(() => superagent.getAttribute("aria-current")).toBe("page");
  await userEvent.click(agentRow);
  await expect.poll(() => superagent.hasAttribute("aria-current")).toBe(false);
  await userEvent.click(superagent);
  await expect.poll(() => superagent.getAttribute("aria-current")).toBe("page");
});

test("a row gives its name to the app's tooltip, which shows it only while the row cuts it", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const long =
    "Move the refresh token rotation into its own handler so that the session store can retry it";
  host.setThreads([thread("agent"), thread("second", { title: long })]);
  await expect.poll(() => threadRows().length).toBe(2);
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-session-row="${id}"] button`)!;
  // The name is the part that the tooltip measures (ToolButton's isClipped).
  const cut = (id: string) => {
    const name = row(id).querySelector<HTMLElement>("[data-clip]")!;
    return name.scrollWidth > name.clientWidth;
  };
  expect(row("second").getAttribute("data-tooltip-clipped")).toBe(long);
  // No tooltip of the browser's own, which would show for a whole name too.
  expect(row("second").hasAttribute("title")).toBe(false);
  expect(cut("second")).toBe(true);
  expect(cut("agent")).toBe(false);
});

test("a row says what waits in its message box: comments that are not sent, or a draft; the thread on screen does not", async () => {
  const draft = "med:draft:typed/claude-typed";
  // A message that another window started: storage tells this one.
  localStorage.setItem(draft, JSON.stringify({ text: "Could this take a locale?", mentions: [] }));
  dispatchEvent(new StorageEvent("storage", { key: draft }));
  onTestFinished(() => {
    localStorage.removeItem(draft);
    dispatchEvent(new StorageEvent("storage", { key: draft }));
  });
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  const session = (id: string) => ({
    agent: "claude" as const,
    id: `claude-${id}`,
    cwd: "/test/repo",
  });
  host.setThreads([
    thread("waits", { title: "Two comments", unsent: 2, updatedAt: now - 1000 }),
    thread("one", { title: "One comment", unsent: 1, updatedAt: now - 2000 }),
    thread("typed", { title: "A draft", session: session("typed"), updatedAt: now - 3000 }),
    thread("plain", { title: "Nothing waits", session: session("plain"), updatedAt: now - 4000 }),
  ]);
  const says = (id: string) =>
    document.querySelector(`[data-session-row="${id}"] [data-unsent]`)?.textContent ?? null;
  await expect.poll(() => says("waits")).toBe("2 comments");
  expect(says("one")).toBe("1 comment");
  expect(says("typed")).toBe("Draft");
  expect(says("plain")).toBeNull();
  // Another window ends the draft: the row follows.
  localStorage.removeItem(draft);
  dispatchEvent(new StorageEvent("storage", { key: draft }));
  await expect.poll(() => says("typed")).toBeNull();
  // On screen, the thread's own message box says it.
  await userEvent.click(document.querySelector<HTMLElement>('[data-session-row="waits"] button')!);
  await expect
    .poll(() =>
      document.querySelector('[data-session-row="waits"] button')?.getAttribute("aria-current"),
    )
    .toBe("page");
  expect(says("waits")).toBeNull();
  expect(says("one")).toBe("1 comment");
});

test("Space, held, peeks at a thread: its card says its state and last words; arrows move, Enter opens, and letting go closes", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  host.setThreads([
    thread("asks", {
      title: "Daylight saving times",
      state: "idle",
      updatedAt: now - 1000,
      branch: "fix-dst",
      changes: { files: 2, additions: 14, deletions: 3 },
      turn: { asks: true, said: "Should the table show each station's own time?" },
    }),
    thread("works", {
      title: "Week view",
      state: "working",
      updatedAt: now - 2000,
      turn: { activity: "Running bun test" },
    }),
    thread("quiet", { title: "Heights in feet", updatedAt: now - 3000 }),
  ]);
  await expect.poll(threadRows).toHaveLength(3);
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-session-row="${id}"] button`)!;
  const card = () => document.querySelector<HTMLElement>("[data-thread-peek]");
  const opened = () =>
    document.querySelector('nav[aria-label="Sessions"] [aria-current="page"]')?.textContent;
  const before = opened();
  // On a row with focus, Space peeks; it does not open the row.
  row("asks").focus();
  await userEvent.keyboard("{Space>}");
  await expect.poll(() => card()?.dataset.threadPeek).toBe("asks");
  expect(card()!.textContent).toContain("Needs you");
  expect(card()!.textContent).toContain("Should the table show each station's own time?");
  expect(card()!.textContent).toContain("fix-dst");
  expect(card()!.textContent).toContain("+14");
  expect(card()!.textContent).toContain("2 files");
  // Beside the row, at its end.
  expect(card()!.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    row("asks").getBoundingClientRect().right,
  );
  // While Space is down, the arrows go to the other rows.
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => card()?.dataset.threadPeek).toBe("works");
  expect(card()!.textContent).toContain("Working");
  expect(card()!.textContent).toContain("Running bun test");
  await userEvent.keyboard("{ArrowUp}");
  await expect.poll(() => card()?.dataset.threadPeek).toBe("asks");
  // Letting go closes it, and nothing opened.
  await userEvent.keyboard("{/Space}");
  await expect.poll(card).toBeNull();
  expect(opened()).toBe(before);
  // The row under the pointer comes before the one with focus.
  await userEvent.hover(row("quiet"));
  await userEvent.keyboard("{Space>}");
  await expect.poll(() => card()?.dataset.threadPeek).toBe("quiet");
  expect(card()!.textContent).toContain("Nothing said yet.");
  // Enter opens the thread shown, and the card goes.
  await userEvent.keyboard("{ArrowUp}{Enter}");
  await expect.poll(card).toBeNull();
  await expect.poll(() => row("works").getAttribute("aria-current")).toBe("page");
  await userEvent.keyboard("{/Space}");
  // In a text field outside the sidebar, Space types: no peek.
  const field = document.createElement("input");
  document.body.append(field);
  onTestFinished(() => field.remove());
  field.focus();
  await userEvent.keyboard("{Space>}");
  expect(card()).toBeNull();
  expect(field.value).toBe(" ");
  await userEvent.keyboard("{/Space}");
});

test("as in Claude's desktop app, the sidebar's top row holds its toggle and Back and Forward, which stay in place as it hides; New is the first row", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("boss", { title: "Superagent", superagent: true, updatedAt: Date.now() }),
  ]);
  const sidebar = document.querySelector<HTMLElement>('nav[aria-label="Sessions"]')!;
  await expect
    .poll(() => sidebar.querySelector('button[data-thread="boss"]')?.textContent)
    .toBe("Superagent");
  const top = sidebar.querySelector(".med-title-row")!;
  expect([...top.querySelectorAll("button")].map((button) => button.ariaLabel)).toEqual([
    "Hide sidebar",
    "Back",
    "Forward",
  ]);
  // The band has no arrows of its own while the sidebar shows them.
  const band = document.querySelector<HTMLElement>('header[aria-label="Workspace"]')!;
  expect(band.querySelector('button[aria-label="Back"]')).toBeNull();
  const newRow = sidebar.querySelector<HTMLElement>('button[aria-label="New thread"]')!;
  expect(newRow.textContent).toBe("New");
  const superagent = sidebar.querySelector<HTMLElement>('button[data-thread="boss"]')!;
  expect(
    newRow.compareDocumentPosition(superagent) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(newRow.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    superagent.getBoundingClientRect().top,
  );

  // The window's top row as TitleRow.css sizes it, in a browser tab.
  const rowSize = document.createElement("style");
  rowSize.textContent =
    ":root { --med-titlebar-left: 0px; --med-titlebar-right: 0px; --med-top-row: 36px; }";
  document.head.append(rowSize);
  onTestFinished(() => rowSize.remove());
  const place = (name: string) => {
    const box = document.querySelector(`button[aria-label^="${name}"]`)!.getBoundingClientRect();
    return [Math.round(box.left), Math.round(box.top)];
  };
  const shownAt = ["Hide sidebar", "Back", "Forward"].map(place);
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await expect.element(page.getByRole("button", { name: /^Show sidebar/ })).toBeVisible();
  expect(["Show sidebar", "Back", "Forward"].map(place)).toEqual(shownAt);
  expect(document.querySelectorAll('button[aria-label="Back"]')).toHaveLength(1);
});

test("a row drags into Pinned, to a place among the pins, and out again; its menu moves a pin", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  host.setThreads([
    thread("agent", { updatedAt: now - 1000 }),
    thread("second", { updatedAt: now - 2000 }),
    thread("third", { updatedAt: now - 3000 }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review", "Third review"]);
  const section = (name: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(`section[aria-label="${name}"] [data-session-row]`),
    ].map((row) => row.querySelector("button")?.getAttribute("data-tooltip-clipped"));
  const button = (title: string) =>
    document.querySelector<HTMLElement>(
      `[data-session-row] button[data-tooltip-clipped="${title}"]`,
    )!;
  const middle = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const settle = () => new Promise((done) => setTimeout(done, 60));
  const pinnedArea = () =>
    document.querySelector('section[aria-label="Pinned"]')!.getBoundingClientRect();
  /** Presses a row, and moves the pointer in steps to wherever `to` says. */
  const drag = async (title: string, to: () => number, release = true) => {
    const start = middle(button(title));
    const at = (y: number) => ({ clientX: start.x, clientY: y, bubbles: true, pointerId: 1 });
    button(title).dispatchEvent(new PointerEvent("pointerdown", { ...at(start.y), button: 0 }));
    document.dispatchEvent(new PointerEvent("pointermove", at(start.y + 8)));
    // The list makes room as the drag starts; the target is read after.
    await settle();
    document.dispatchEvent(new PointerEvent("pointermove", at(to())));
    await settle();
    document.dispatchEvent(new PointerEvent("pointermove", at(to())));
    await settle();
    if (release) document.dispatchEvent(new PointerEvent("pointerup", at(to())));
  };
  const pins = () => host.threadRequests.filter((request) => request.path.endsWith("/pin"));

  // With no pins, Pinned shows while a row drags, to drop into.
  await drag("Third review", () => pinnedArea().bottom - 8);
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/third/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Third review"]);
  expect(section("Recent")).toEqual(["Agent review", "Second review"]);
  // The press was a drag: it opened nothing.
  expect(threadRows().some((row) => row.endsWith("(current)") && row.startsWith("Third"))).toBe(
    false,
  );

  // Above the first pin's middle is the first place.
  await drag("Agent review", () => button("Third review").getBoundingClientRect().top + 4);
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/agent/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Agent review", "Third review"]);

  // The menu moves a pin one place, as a drag would.
  await button("Third review").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  await expect.element(page.getByRole("menuitem", { name: "Move down" })).not.toBeInTheDocument();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/third/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Third review", "Agent review"]);

  // Esc puts the row back, and pins nothing.
  const before = pins().length;
  await drag("Second review", () => middle(button("Third review")).y, false);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  expect(pins().length).toBe(before);
  await expect.poll(() => section("Recent")).toEqual(["Second review"]);

  // Below Pinned is Recent: the row goes back to its place by activity.
  await drag(
    "Agent review",
    () => section("Recent").length && middle(button("Second review")).y + 20,
  );
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/agent/pin", body: { pinned: false } });
  await expect.poll(() => section("Recent")).toEqual(["Agent review", "Second review"]);
  expect(section("Pinned")).toEqual(["Third review"]);
});

test("Later folds away under Recent; rows go there by their menu or a drag; Archive all clears Recent but work and questions, and Undo brings it back", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  host.setThreads([
    thread("agent", { updatedAt: now - 1000 }),
    thread("second", { updatedAt: now - 2000 }),
    thread("third", { updatedAt: now - 3000, agent: "claude", state: "working" }),
    thread("fourth", { updatedAt: now - 4000, agent: "claude", state: "waiting" }),
  ]);
  await expect
    .poll(threadRows)
    .toEqual([
      "Agent review",
      "Second review",
      "Third review, working",
      "Fourth review, needs you",
    ]);
  const section = (name: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(`section[aria-label="${name}"] [data-session-row]`),
    ].map((row) => row.querySelector("button")?.getAttribute("data-tooltip-clipped"));
  const button = (title: string) =>
    document.querySelector<HTMLElement>(
      `[data-session-row] button[data-tooltip-clipped="${title}"]`,
    )!;
  const menu = async (title: string, item: string) => {
    button(title).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    // An item's name ends with its key.
    await page.getByRole("menuitem", { name: new RegExp(`^${item}`) }).click();
  };
  const requests = (verb: string) =>
    host.threadRequests.filter((request) => request.path.endsWith(`/${verb}`));

  // The row's menu puts it in Later, under Recent.
  await menu("Second review", "Move to Later");
  await expect
    .poll(() => requests("later").at(-1))
    .toEqual({ path: "/api/threads/second/later", body: { later: true, at: 0 } });
  await expect.poll(() => section("Later")).toEqual(["Second review"]);
  expect(section("Recent")).toEqual(["Agent review", "Third review", "Fourth review"]);

  // Later folds to one row that counts its sessions, and stays folded.
  const later = page.getByRole("region", { name: "Later" });
  await later.getByRole("button", { name: /Later/ }).click();
  await expect.poll(() => section("Later")).toEqual([]);
  await expect
    .element(later.getByRole("button", { name: "Later, 1 session" }))
    .toHaveAttribute("aria-expanded", "false");
  await later.getByRole("button", { name: /Later/ }).click();
  await expect.poll(() => section("Later")).toEqual(["Second review"]);

  // A drag puts a row in Later too, above the first one's middle.
  const start = button("Agent review").getBoundingClientRect();
  const at = (y: number) => ({
    clientX: start.left + 20,
    clientY: y,
    bubbles: true,
    pointerId: 1,
  });
  const settle = () => new Promise((done) => setTimeout(done, 60));
  const target = () => button("Second review").getBoundingClientRect().top + 4;
  button("Agent review").dispatchEvent(
    new PointerEvent("pointerdown", { ...at(start.top + 10), button: 0 }),
  );
  document.dispatchEvent(new PointerEvent("pointermove", at(start.top + 18)));
  await settle();
  document.dispatchEvent(new PointerEvent("pointermove", at(target())));
  await settle();
  document.dispatchEvent(new PointerEvent("pointermove", at(target())));
  await settle();
  document.dispatchEvent(new PointerEvent("pointerup", at(target())));
  await expect
    .poll(() => requests("later").at(-1))
    .toEqual({ path: "/api/threads/agent/later", body: { later: true, at: 0 } });
  await expect.poll(() => section("Later")).toEqual(["Agent review", "Second review"]);

  // And back to Recent by the menu.
  await menu("Agent review", "Move to Recent");
  await expect
    .poll(() => requests("later").at(-1))
    .toEqual({ path: "/api/threads/agent/later", body: { later: false } });
  await expect.poll(() => section("Later")).toEqual(["Second review"]);

  // Archive all archives Recent's sessions but the one at work and the one
  // that waits on the reader; Later keeps its own.
  await page.getByRole("button", { name: "Archive all" }).click();
  await expect
    .poll(() => requests("close").map((request) => request.path))
    .toEqual(["/api/threads/agent/close"]);
  await expect.poll(() => section("Recent")).toEqual(["Third review", "Fourth review"]);
  expect(section("Later")).toEqual(["Second review"]);
  await expect.element(page.getByText("Archived “Agent review”.")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => requests("open").at(-1))
    .toEqual({ path: "/api/threads/agent/open", body: { restore: true } });
  await expect
    .poll(() => section("Recent"))
    .toEqual(["Agent review", "Third review", "Fourth review"]);
});

test("a quick drag moves each row once, the row in the hand stays under the pointer, and the drop settles it into its place", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  const names = ["p1", "p2", "p3", "p4", "p5", "p6"];
  host.setThreads([
    ...names.map((id, index) => thread(id, { pinned: index + 1, updatedAt: now - index * 1000 })),
    thread("agent", { updatedAt: now }),
  ]);
  const pinned = () =>
    [
      ...document.querySelectorAll<HTMLElement>('section[aria-label="Pinned"] [data-session-row]'),
    ].map((row) => row.querySelector("button")?.getAttribute("data-tooltip-clipped"));
  await expect.poll(pinned).toEqual(names);
  const top = (id: string) =>
    document.querySelector(`[data-session-row="${id}"]`)!.getBoundingClientRect().top;
  const lifted = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'nav[aria-label="Sessions"] > [aria-hidden="true"]',
      ),
    ].find((element) => getComputedStyle(element).position === "fixed");
  const first = document.querySelector('[data-session-row="p1"]')!.getBoundingClientRect();
  const start = { x: first.left + first.width / 2, y: first.top + first.height / 2 };
  const at = (y: number) => ({ clientX: start.x, clientY: y, bubbles: true, pointerId: 1 });
  const frame = () => new Promise<number>((done) => requestAnimationFrame(done));

  // A flick: three moves a frame, down past four rows in four frames, to
  // between the fifth row and the sixth. Every frame notes where each row
  // shows, where the row in the hand does, and when.
  const end = first.top + 5 * first.height + 8;
  const flick = Array.from(
    { length: 12 },
    (_, step) => start.y + ((end - start.y) * (step + 1)) / 12,
  );
  const frames: {
    rows: Record<string, number>;
    lifted?: number;
    pointer: number;
    time: number;
  }[] = [];
  let pointer = start.y;
  document
    .querySelector<HTMLElement>('[data-session-row="p1"] button')!
    .dispatchEvent(new PointerEvent("pointerdown", { ...at(start.y), button: 0 }));
  const RELEASE = 30;
  for (let index = 0; index < RELEASE + 30; index++) {
    const time = await frame();
    for (const y of flick.slice(index * 3, index * 3 + 3)) {
      pointer = y;
      document.dispatchEvent(new PointerEvent("pointermove", at(y)));
    }
    if (index === RELEASE) document.dispatchEvent(new PointerEvent("pointerup", at(pointer)));
    frames.push({
      rows: Object.fromEntries(names.map((id) => [id, top(id)])),
      lifted: lifted()?.getBoundingClientRect().top,
      pointer,
      time,
    });
  }

  // Each row the pointer passed moves up once, by its height, and never
  // back; the last one stays.
  const held = frames.slice(0, RELEASE);
  const motion = (id: string) => {
    const tops = held.map((entry) => entry.rows[id]!);
    const travel = tops.slice(1).reduce((sum, y, index) => sum + Math.abs(y - tops[index]!), 0);
    return { moved: Math.round(tops.at(-1)! - tops[0]!), travel: Math.round(travel) };
  };
  expect(names.slice(1).map(motion)).toEqual([
    ...names.slice(1, 5).map(() => ({ moved: -first.height, travel: first.height })),
    { moved: 0, travel: 0 },
  ]);
  // The row in the hand is where the pointer holds it, in every frame.
  for (const entry of held)
    expect(entry.lifted).toBeCloseTo(entry.pointer - (start.y - first.top), 0);
  // At the release, it glides into its place in steps, not one jump: no
  // faster than half the way in a frame's time. A frame the page drew late
  // shows the glide further on, as the time it took.
  const settling = frames.slice(RELEASE - 1);
  const dropped = settling.map((entry) => entry.lifted ?? entry.rows.p1!);
  const place = first.top + 4 * first.height;
  expect(dropped[0]! - place).toBeGreaterThan(20);
  const speeds = dropped.slice(1).map((y, index) => {
    const took = (settling[index + 1]!.time - settling[index]!.time) / (1000 / 60);
    return Math.abs(y - dropped[index]!) / Math.max(1, Math.round(took));
  });
  expect(Math.max(...speeds)).toBeLessThan(12);
  expect(dropped.at(-1)).toBeCloseTo(place, 0);
  await expect
    .poll(() => host.threadRequests.filter((request) => request.path.endsWith("/pin")).at(-1))
    .toEqual({ path: "/api/threads/p1/pin", body: { pinned: true, at: 4 } });
  await expect.poll(pinned).toEqual(["p2", "p3", "p4", "p5", "p1", "p6"]);

  // With reduced motion, nothing glides: the rows take their places at once,
  // and the drop ends at once.
  const matchMedia = window.matchMedia.bind(window);
  const reduced = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      query === "(prefers-reduced-motion: reduce)"
        ? ({ matches: true } as MediaQueryList)
        : matchMedia(query),
    );
  onTestFinished(() => reduced.mockRestore());
  const glides = () =>
    document
      .getAnimations()
      .filter((animation) =>
        (animation.effect as KeyframeEffect | null)?.target?.closest("nav[aria-label='Sessions']"),
      );
  const p1 = document.querySelector('[data-session-row="p1"]')!.getBoundingClientRect();
  document
    .querySelector<HTMLElement>('[data-session-row="p1"] button')!
    .dispatchEvent(new PointerEvent("pointerdown", { ...at(p1.top + 16), button: 0 }));
  for (const y of [p1.top + 8, first.top + 24, first.top + 8]) {
    document.dispatchEvent(new PointerEvent("pointermove", at(y)));
    expect(glides()).toEqual([]);
  }
  expect(top("p2")).toBe(first.top + first.height);
  document.dispatchEvent(new PointerEvent("pointerup", at(first.top + 8)));
  expect(lifted()).toBeUndefined();
  expect(glides()).toEqual([]);
  expect(top("p1")).toBe(first.top);
});

test("a row's ⋯ button is in the row's middle, as far from its end as from its top and foot", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("agent"), thread("second", { pinned: 1 })]);
  await expect.poll(threadRows).toEqual(["Second review", "Agent review"]);
  const insets = (id: string) => {
    const row = document.querySelector(`[data-session-row="${id}"]`)!;
    const box = row.getBoundingClientRect();
    const more = row.querySelector('button[aria-haspopup="menu"]')!.getBoundingClientRect();
    return {
      middle: more.top + more.height / 2 - (box.top + box.height / 2),
      top: more.top - box.top,
      foot: box.bottom - more.bottom,
      end: box.right - more.right,
      round: more.width === more.height,
    };
  };
  const centred = { middle: 0, top: 4, foot: 4, end: 4, round: true };
  expect(insets("agent")).toEqual(centred);
  await userEvent.hover(page.getByRole("button", { name: "Agent review", exact: true }));
  expect(insets("agent")).toEqual(centred);
  await page.getByRole("button", { name: "Actions for Agent review" }).click();
  await expect.element(page.getByRole("menu")).toBeVisible();
  expect(insets("agent")).toEqual(centred);
  await userEvent.keyboard("{Escape}");
  themeController.commit("graphite-light");
  expect(insets("second")).toEqual(centred);
});

test("a new thread starts its agent in a new worktree and opens", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const dialog = page.getByRole("dialog", { name: "New thread" });
  await expect.element(dialog).toBeVisible();
  const task = dialog.getByRole("combobox", { name: "Task" });
  await expect.element(task).toHaveFocus();
  // The page asks where to work; the repository on screen is chosen.
  const repositories = dialog.getByRole("listbox", { name: "Repositories" });
  await expect
    .element(repositories.getByRole("option", { name: /^fixture/, selected: true }))
    .toBeVisible();
  // Under the composer, one line of choices; each shows its choice.
  const where = dialog.getByRole("button", { name: /^Where the agent works: / });
  const model = dialog.getByRole("combobox", { name: "Model", exact: true });
  await task.fill("Show each result's age in the list");
  // Two places to work: a click switches between them. The worktree names
  // the branch that Med creates; the checkout names its own.
  await expect.element(where).toHaveTextContent("New worktree");
  await expect
    .element(where)
    .toHaveAccessibleName("Where the agent works: New worktree · show-each-results-age-list");
  await expect.element(where).toHaveAccessibleDescription("Switch to Checkout · main");
  await where.click();
  await expect.element(where).toHaveAccessibleName("Where the agent works: Checkout · main");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await where.click();
  await expect.element(where).toHaveTextContent("New worktree");
  await expect.element(dialog).toBeVisible();
  // Med chooses Opus at medium effort: the agent's mark, the model, and the
  // effort, in one picker. The only agent is a fact, not a choice. The
  // choice stays for the next thread.
  await expect.element(model).toHaveTextContent("Opus 5.5medium");
  await model.click();
  const picker = page.getByRole("dialog", { name: "Model" });
  await expect.element(picker.getByRole("option", { name: "Haiku 4.5" })).toBeVisible();
  await expect.element(picker.getByRole("group", { name: "Agent" })).not.toBeInTheDocument();
  // The picker sits at the line's end, so it ends where its trigger ends; a
  // choice's check is at its row's end. Models show by name alone.
  const right = (element: Element) => element.getBoundingClientRect().right;
  await expect
    .poll(() => Math.abs(right(picker.element()) - right(model.element())))
    .toBeLessThan(1);
  const opus = picker.getByRole("option", { name: "Opus 5.5" });
  await expect.element(opus).toHaveAttribute("aria-selected", "true");
  const check = opus.element().querySelector("[data-check] svg")!;
  expect(right(opus.element()) - right(check)).toBeLessThanOrEqual(11);
  expect(picker.element().textContent).not.toContain("Recommended");
  // The effort is the row under the models.
  await picker.getByRole("radio", { name: "high" }).click();
  await expect.element(model).toHaveTextContent("Opus 5.5high");
  await userEvent.keyboard("{Escape}");
  await expect.element(picker).not.toBeInTheDocument();
  await expect.element(dialog).toBeVisible();
  // The composer sits right under the list, both in the page's middle, and
  // its choices under it.
  const box = task.element().getBoundingClientRect();
  const list = repositories.element().getBoundingClientRect();
  expect(list.bottom).toBeLessThan(box.top);
  expect(box.top - list.bottom).toBeLessThan(64);
  expect(box.bottom).toBeLessThan(dialog.element().getBoundingClientRect().height * 0.8);
  expect(model.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom);
  expect(box.right - model.element().getBoundingClientRect().right).toBeLessThan(16);
  // The task's bar, as a thread's message box: images at its start, and
  // Start at its end, which Enter also does.
  const start = dialog.getByRole("button", { name: "Start", exact: true });
  await expect.element(start).toBeEnabled();
  expect(start.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom - 1);
  expect(start.element().getBoundingClientRect().bottom).toBeLessThan(
    model.element().getBoundingClientRect().top,
  );
  // An image pastes into the task, as into a thread's message box, and goes
  // with it; × takes one back.
  await expect.element(dialog.getByRole("button", { name: "Add images" })).toBeVisible();
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const paste = () => {
    const clipboard = new DataTransfer();
    clipboard.items.add(
      new File([Uint8Array.from(atob(png), (char) => char.charCodeAt(0))], "shot.png", {
        type: "image/png",
      }),
    );
    task
      .element()
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true }));
  };
  paste();
  paste();
  const images = dialog.getByRole("list", { name: "Images to send" });
  await expect.poll(() => images.getByRole("listitem").elements().length).toBe(2);
  await images.getByRole("button", { name: "Remove attachment 2" }).click();
  await expect.poll(() => images.getByRole("listitem").elements().length).toBe(1);
  await expect.element(task).toHaveAttribute("data-value", "Show each result's age in the list");
  // ⌘↵ starts from anywhere on the page: here, from the model's picker.
  (model.element() as HTMLElement).focus();
  await expect.element(page.getByRole("dialog", { name: "Model" })).not.toBeInTheDocument();
  await expect.element(model).toHaveFocus();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .poll(() => host.threadRequests, { timeout: 5_000 })
    .toEqual([
      {
        path: "/api/threads",
        body: {
          repositoryId: "repo-0",
          prompt: "Show each result's age in the list",
          title: "Show each result's age in the list",
          preset: "claude",
          worktree: true,
          choices: { model: "opus", effort: "high" },
          images: [{ mimeType: "image/png", data: png }],
        },
      },
    ]);
  await expect.element(dialog).not.toBeInTheDocument();
  // The new thread opens on its checkout's Changes, beside its session.
  await expect.poll(() => location.pathname).toBe("/review/claude-started");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("review-/test/repo");

  // A model without efforts has no effort to choose. Escape leaves a new
  // thread that has not started.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect.element(dialog).toBeVisible();
  await expect.element(model).toHaveTextContent("Opus 5.5high");
  await model.click();
  await page.getByRole("option", { name: "Haiku 4.5" }).click();
  await expect.poll(() => model.element().textContent).toBe("Haiku 4.5");
  await model.click();
  await expect
    .element(page.getByRole("dialog", { name: "Model" }).getByRole("radiogroup"))
    .not.toBeInTheDocument();
  await page.getByRole("option", { name: "Opus 5.5" }).click();
  await expect.element(model).toHaveTextContent("Opus 5.5high");
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  expect(location.pathname).toBe("/review/claude-started");

  // A repository chosen here wins over the repository on screen. Typing in
  // the filter narrows the list, and Enter picks. With two repositories, the
  // line's Repository switches between them.
  host.setThreads(
    [thread("agent")],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo", branch: "main" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect
    .element(repositories.getByRole("option", { name: /^fixture/, selected: true }))
    .toBeVisible();
  const repository = dialog.getByRole("button", { name: /^Repository: / });
  await expect.element(repository).toHaveAccessibleName("Repository: fixture");
  await dialog.getByRole("combobox", { name: "Filter repositories" }).click();
  await userEvent.keyboard("oth");
  await expect.poll(() => repositories.getByRole("option").all().length).toBe(1);
  await userEvent.keyboard("{Enter}");
  await expect
    .element(repositories.getByRole("option", { name: /^other/, selected: true }))
    .toBeVisible();
  await expect.element(repository).toHaveAccessibleName("Repository: other");
  await expect.element(task).toHaveFocus();
  // Med does not know the other checkout's branch.
  await where.click();
  await expect.element(where).toHaveAccessibleName("Where the agent works: Checkout");
  // Enter in the task starts; ⇧Enter adds a line.
  await task.click();
  await userEvent.keyboard("Rank results{Shift>}{Enter}{/Shift}by age");
  await expect.element(task).toHaveAttribute("data-value", "Rank results\nby age");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ repositoryId: "repo-1", prompt: "Rank results\nby age", worktree: false });

  // @ names a vault's note: the agent gets its path, and the title its name.
  // Enter takes the note while the list is open, then starts.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await task.click();
  await userEvent.keyboard("Follow @ages");
  await expect
    .element(dialog.getByRole("group", { name: "Notes" }).getByRole("option", { name: /Ages\.md/ }))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(task).toHaveAttribute("data-value", "Follow @Ages.md ");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ prompt: "Follow /test/notes/Plans/Ages.md ", title: "Follow @Ages.md" });
});

test("reviews that agents announce show in the window used last", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await expect.poll(() => host.windows.size).toBe(1);

  // Another window was used last: this one keeps its own workspace on screen.
  localStorage.setItem(WINDOW_KEY, "window-elsewhere");
  host.announce({ id: "agent", open: true });
  host.setThreads([thread("agent", { updatedAt: Date.now() + 1000 })]);
  await expect.poll(threadRows).toEqual(["Agent review, new"]);
  expect(shown()?.dataset.selectedBranch).toBe("main");

  // A click shows it and makes this the window used last.
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");

  // Now this window shows the next review that opens.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  host.announce({ id: "second", open: true });
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
});

test("a pasted pull request link opens a workspace at once, which becomes its review", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("New workspace");
  await userEvent.keyboard("{Enter}");
  await page
    .getByRole("combobox", { name: "Search branches" })
    .fill("https://github.com/acme/trails/pull/7/files");
  await expect.element(page.getByRole("option", { name: /Open pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");

  // The workspace shows at once, with its progress.
  const progress = page.getByRole("region", { name: "Opening the pull request" });
  await expect.element(progress).toBeVisible();
  expect(host.pulls).toEqual([{ id: "job-1", url: "https://github.com/acme/trails/pull/7" }]);

  // A failed step says why, and Retry asks the host again.
  host.setPull({
    status: "failed",
    error: "Add a clone of acme/trails to Med, then open the link again.",
    steps: [{ id: "repository", label: "Find acme/trails", state: "failed" }],
  });
  const problem = () =>
    document.querySelector('[aria-label="Opening the pull request"] [role="alert"]')?.textContent;
  await expect
    .poll(problem)
    .toMatch(/^Add a clone of acme\/trails to Med, then open the link again\./);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => host.pulls.length).toBe(2);
  await expect.poll(problem).toBeUndefined();

  // The saved review takes the workspace's place.
  host.setPull({ title: "Add durations" });
  host.setPull({ status: "done", reviewId: "agent" });
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  expect(location.pathname).toBe("/review/agent");
});

test("⌘⇧F opens the workspace's Search tab; a match opens in a file tab, and the tab keeps its results", async () => {
  // A second registered repository, for repo: filters.
  repositories.push({ id: "repo-1", path: "/test/other", name: "other", branches, worktrees: [] });
  onTestFinished(() => void repositories.splice(1));
  const host = createHost();
  render(host);
  host.setThreads(
    [],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const searchKey = () => userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const panel = page.getByRole("tabpanel", { name: "Search", exact: true });

  await searchKey();
  const query = page.getByRole("combobox", { name: "Search query" });
  await expect.element(query).toHaveFocus();
  await expect.element(query).toHaveValue("");
  await expect.element(tab("Search")).toHaveAttribute("aria-selected", "true");
  expect(location.pathname).toBe("/");

  // Results show as you type, from this checkout only; the tab names the query.
  await userEvent.keyboard("AFTER");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  // A slow typist sends a search for what they have typed so far, too.
  expect(host.searches.at(-1)).toBe("/test/repo AFTER");
  expect(host.searches.every((search) => search.startsWith("/test/repo "))).toBe(true);
  await expect.element(tab("Search: AFTER")).toHaveAttribute("aria-selected", "true");
  await expect
    .element(panel.getByRole("option", { selected: true }))
    .toHaveTextContent("1export const after = 2;");
  expect(panel.element().querySelector("mark")?.textContent).toBe("after");

  // repo:* searches every repository.
  await query.fill("repo:* after");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("2 results in 2 files across 2 repositories");
  expect(host.searches).toContain("/test/other after");

  // Enter opens the chosen match in the working file's tab here.
  await query.fill("after");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await expect.element(tab("Search: after")).toHaveAttribute("aria-selected", "false");
  expect(
    document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-tooltip"),
  ).toMatch(/^src\/alpha\.ts · Working files/);
  expect(location.pathname).toBe("/");

  // ⌘⇧F shows the same tab, with its query selected and its results.
  const searches = host.searches.length;
  await searchKey();
  await expect.element(tab("Search: after")).toHaveAttribute("aria-selected", "true");
  await expect.element(query).toHaveFocus();
  const field = query.element() as HTMLInputElement;
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, "after".length]);
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  expect(host.searches).toHaveLength(searches);
  expect(page.getByRole("tab", { name: /^Search/ }).elements()).toHaveLength(1);

  // Escape shows the tab that showed before; ⌥W in the query closes the tab.
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await tab("Search: after").click();
  await expect.element(query).toHaveFocus();
  query
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "∑", code: "KeyW", altKey: true, bubbles: true }),
    );
  await expect.element(tab("Search: after")).not.toBeInTheDocument();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");

  // An old search link opens the Search tab with its query.
  history.pushState(null, "", "/search?q=AFTER");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(tab("Search: AFTER")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => location.pathname).toBe("/");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");

  // A match in another repository opens in that repository's workspace.
  await query.fill("repo:other after");
  await expect.element(panel.getByRole("status")).toHaveTextContent("1 result in 1 file in other");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("lib/other.ts");
});

test("Back and Forward retrace pages, files, and workspaces; a new page opens on the screen shown last", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const back = page.getByRole("button", { name: "Back", exact: true });
  const forward = page.getByRole("button", { name: "Forward", exact: true });
  const onPage = () =>
    document
      .querySelector('[role="radiogroup"][aria-label="Page"] [aria-checked="true"]')
      ?.getAttribute("aria-label");
  await expect.poll(onPage).toBe("Changes");

  // Each page, and each file, is a step.
  await page.getByRole("radio", { name: "Commit", exact: true }).click();
  await expect.poll(onPage).toBe("Commit");
  await page.getByRole("radio", { name: "Changes", exact: true }).click();
  await expect.poll(onPage).toBe("Changes");
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await expect.poll(onPage).toBe("Files");
  await back.click();
  await expect.poll(onPage).toBe("Changes");
  expect(shown()?.dataset.activeFile).toBe("");
  await back.click();
  await expect.poll(onPage).toBe("Commit");
  await forward.click();
  await expect.poll(onPage).toBe("Changes");
  await forward.click();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await expect.element(forward).toBeDisabled();

  // Another workspace is a step too; Back shows this one as it was.
  await userEvent.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
  await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await back.click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await forward.click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");

  // A new page opens on the screen that showed last: main's Commit page.
  await back.click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await page.getByRole("radio", { name: "Commit", exact: true }).click();
  await expect.poll(onPage).toBe("Commit");
  root!.unmount();
  mount!.remove();
  render(createHost());
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(onPage).toBe("Commit");
  // So does a launch at the app's own address, with no entry of its own:
  // not an empty workspace. The address keeps what a link to Med carried.
  root!.unmount();
  mount!.remove();
  history.replaceState(null, "", "/?example=kept#anchor=kept");
  render(createHost());
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(onPage).toBe("Commit");
  expect(location.search).toBe("?example=kept");
  expect(location.hash).toBe("#anchor=kept");
});

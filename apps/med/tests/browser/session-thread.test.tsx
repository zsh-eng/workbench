import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { HandoffContext } from "../../src/web/components/session/HandoffCard";
import {
  ReplyActionsContext,
  SessionThread,
  type ReplyActions,
} from "../../src/web/components/session/SessionThread";
import { withSentMessages, type SentMessage } from "../../src/web/data/agent-inbox";
import { createSessionStore } from "../../src/web/data/session-store";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";
import {
  afterFrames,
  cleanUp,
  frame,
  longThread,
  mount,
  nextFrame,
  remount,
  root,
  setup,
  threadScroller,
  topOf,
  turnEvents,
  units,
} from "./session-fixture";

afterEach(cleanUp);

test("the replay plays a recorded session into the thread and stops when paused", async () => {
  const replay = await setup();
  // The page opens on the whole session.
  await expect.element(replay.getByText(/Worked for \d+s · 13 tool calls/)).toBeVisible();

  await userEvent.click(replay.getByRole("button", { name: "Play" }));
  await userEvent.click(replay.getByRole("button", { name: "16×" }));
  // From the start, only the prompt is there; the agent's work follows.
  await expect.element(replay.getByText(/^Working|^Thinking/)).toBeVisible();
  await userEvent.click(replay.getByRole("button", { name: "Pause" }));
  const position = replay.getByRole("slider", { name: "Position" });
  const paused = (position.element() as HTMLInputElement).value;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((position.element() as HTMLInputElement).value).toBe(paused);
  expect(replay.getByText("Edited", { exact: false }).query()).toBeNull();

  // A move along the slider plays the session up to there at once.
  (position.element() as HTMLInputElement).focus();
  await userEvent.keyboard("{PageUp}".repeat(8));
  await expect.element(replay.getByText("Edited", { exact: false }).first()).toBeVisible();
  await userEvent.click(replay.getByRole("button", { name: "Play" }));
  await expect.element(replay.getByText(/Worked for \d+s/), { timeout: 10000 }).toBeVisible();
  await expect.element(replay.getByText("summary.ts:5", { exact: true })).toBeVisible();
  // Rows that fold into a group make the thread shorter; the view still followed to the end.
  await expect.element(replay.getByRole("button", { name: "Latest" })).not.toBeInTheDocument();
});

test("a tool call opens to show its command and output", async () => {
  const replay = await setup();
  // The finished turn's work is folded.
  await userEvent.click(replay.getByRole("button", { name: /Worked for/ }));
  const row = replay.getByRole("button", { name: /Run the test suite/ });
  await expect.element(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  await expect.element(row).toHaveAttribute("aria-expanded", "true");
  await expect.element(replay.getByText("7 pass", { exact: false })).toBeVisible();
});

test("the sample thread shows a plan, a failed test, and a subagent's own steps", async () => {
  await setup();
  const gallery = page.getByRole("figure").filter({ hasText: "Every part" });
  await expect
    .element(gallery.getByRole("region", { name: "Tasks" }).getByText("1 of 4"))
    .toBeVisible();
  // The dev server runs in the background; its address comes from its output.
  const background = gallery.getByRole("region", { name: "Background tasks" });
  await expect.element(background.getByText("1 running")).toBeVisible();
  await expect
    .element(background.getByRole("link", { name: "localhost:5173" }))
    .toHaveAttribute("href", "http://localhost:5173");
  await expect
    .element(gallery.getByRole("button", { name: /Run the branch tests.*Failed/ }))
    .toBeVisible();
  await userEvent.click(
    gallery.getByRole("log").getByRole("button", { name: /^Find every place that fetches/ }),
  );
  await expect.element(gallery.getByText(/Two paths fetch/)).toBeVisible();
});

test("a task in the Background dock scrolls a long thread to its call", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "server",
        title: "Start the dev server",
        kind: "execute",
        status: "in_progress",
        _meta: { med: { background: { id: "b1", kind: "shell" } } },
      },
    },
    ...turnEvents(1, 300),
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r300");
  expect(document.querySelector('[data-unit="server"]')).toBeNull();
  await userEvent.click(
    page.getByRole("region", { name: "Background tasks" }).getByRole("button", {
      name: "Start the dev server",
    }),
  );
  await expect.poll(() => document.querySelector('[data-unit="server"]')).not.toBeNull();
  await expect.poll(() => Math.round(topOf("server"))).toBe(16);
});

test("in the side panel, the Background dock sits outside the thread and still scrolls it to a task's call", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "server",
        title: "Start the dev server",
        kind: "execute",
        status: "in_progress",
        _meta: { med: { background: { id: "b1", kind: "shell" } } },
      },
    },
    ...turnEvents(1, 300),
  ]);
  const side = document.createElement("div");
  document.body.append(side);
  try {
    root!.render(<SessionThread snapshot={store.getSnapshot()} backgroundIn={side} />);
    await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r300");
    const dock = page.getByRole("region", { name: "Background tasks" });
    await expect.element(dock).toBeVisible();
    expect(side.contains(dock.element())).toBe(true);
    await userEvent.click(dock.getByRole("button", { name: "Start the dev server" }));
    await expect.poll(() => document.querySelector('[data-unit="server"]')).not.toBeNull();
    await expect.poll(() => Math.round(topOf("server"))).toBe(16);
  } finally {
    side.remove();
  }
});

test("the Background dock lists only what runs: a task ends in its place, Done leaves, and Failed stays until seen", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  localStorage.removeItem("med:background-hidden");
  localStorage.removeItem("med:background-seen");
  // On the real clock: a running task's time follows it.
  const base = Date.now() - 10_000;
  const shell = (
    at: number,
    id: string,
    title: string,
    command: string,
    status: "in_progress" | "completed" | "failed" = "completed",
  ) => ({
    at: base + at,
    update: {
      sessionUpdate: "tool_call" as const,
      toolCallId: id,
      title,
      kind: "execute" as const,
      status,
      rawInput: { command },
      _meta: { med: { background: { id, kind: "shell" as const } } },
    },
  });
  const end = (at: number, id: string) => ({
    at: base + at,
    update: {
      sessionUpdate: "tool_call_update" as const,
      toolCallId: id,
      status: "completed" as const,
    },
  });
  const prompt = (at: number, text: string) => ({
    at: base + at,
    update: {
      sessionUpdate: "user_message_chunk" as const,
      content: { type: "text" as const, text },
    },
  });
  const store = longThread(0);
  store.applyAll([
    prompt(0, "Format the durations."),
    shell(100, "server", "Start the dev server", "bun run dev", "in_progress"),
    shell(200, "old", "Fail the old bundle", "bun run build", "failed"),
    prompt(5000, "Use minutes."),
    shell(6000, "tests", "Run the tests", "bun test"),
    shell(6200, "bundle", "Build the bundle", "bun run build", "failed"),
    shell(6500, "wait", "Wait for the review", "med review wait --key durations", "in_progress"),
  ]);
  const render = () => root!.render(<SessionThread snapshot={store.getSnapshot()} showWork />);
  render();
  const dock = page.getByRole("region", { name: "Background tasks" });
  await expect.element(dock.getByText("1 running · 1 failed")).toBeVisible();
  await expect.element(dock.getByRole("button", { name: "Start the dev server" })).toBeVisible();
  // A failure since the last prompt stays until seen; a task that ended
  // before the dock saw it run is gone, as is Med's own wait.
  await expect.element(dock.getByText("Failed", { exact: true })).toBeVisible();
  await expect.element(dock.getByText("Run the tests")).not.toBeInTheDocument();
  await expect.element(dock.getByText("Fail the old bundle")).not.toBeInTheDocument();
  await expect.element(dock.getByText("Wait for the review")).not.toBeInTheDocument();
  await expect.element(page.getByRole("log").getByText("for your message in Med")).toBeVisible();
  // Opening the failure is seeing it.
  await userEvent.click(dock.getByRole("button", { name: "Build the bundle" }));
  await expect.element(dock.getByText("Build the bundle")).not.toBeInTheDocument();
  await expect.element(dock.getByText("1 running", { exact: true })).toBeVisible();

  // A task that ends while the dock shows it says Done in its place, then leaves.
  store.applyAll([shell(7000, "lint", "Lint the code", "bun run lint", "in_progress")]);
  render();
  const row = () => dock.getByRole("listitem").filter({ hasText: "Lint the code" });
  await expect.element(row().getByText("Running", { exact: true })).toBeVisible();
  const element = row().element();
  store.applyAll([end(8000, "lint"), end(8000, "server")]);
  render();
  await expect.element(row().getByText("Done", { exact: true })).toBeVisible();
  expect(row().element()).toBe(element);
  expect(
    dock
      .getByRole("listitem")
      .elements()
      .map((item) => item.textContent),
  ).toEqual([
    expect.stringContaining("Start the dev server"),
    expect.stringContaining("Lint the code"),
  ]);
  // Nothing runs: the dock goes.
  await expect.element(dock, { timeout: 5000 }).not.toBeInTheDocument();

  // A new task shows it; hiding it lasts until a new task starts.
  store.applyAll([shell(9000, "styles", "Watch the styles", "bun run watch", "in_progress")]);
  render();
  await expect.element(dock.getByText("1 running", { exact: true })).toBeVisible();
  await userEvent.click(dock.getByRole("button", { name: "Hide background tasks" }));
  await expect.element(dock).not.toBeInTheDocument();
  // The thread opens again, and the dock stays hidden.
  remount();
  render();
  await expect.element(page.getByRole("log").getByText("Watch the styles")).toBeVisible();
  await expect.element(dock).not.toBeInTheDocument();
  // A failure that the reader has not seen brings it back.
  store.applyAll([shell(9000, "styles", "Watch the styles", "bun run watch", "failed")]);
  render();
  await expect.element(dock.getByText("1 failed", { exact: true })).toBeVisible();
  await userEvent.click(dock.getByRole("button", { name: "Hide background tasks" }));
  await expect.element(dock).not.toBeInTheDocument();
  store.applyAll([shell(10000, "docs", "Serve the docs", "bun run docs", "in_progress")]);
  render();
  await expect.element(dock.getByText("1 running", { exact: true })).toBeVisible();
  await expect.element(dock.getByText("Watch the styles")).not.toBeInTheDocument();
  localStorage.removeItem("med:background-hidden");
  localStorage.removeItem("med:background-seen");
});

test("tabs switch between the session and its subagents, and Escape goes back", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const text = (value: string) => ({ type: "text" as const, text: value });
  const within = (parent: string) => ({ med: { parentToolCallId: parent } });
  const store = longThread(0);
  store.applyAll([
    { at: 0, update: { sessionUpdate: "user_message_chunk", content: text("Clear the cache.") } },
    {
      at: 1000,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fetches",
        title: "Find every place that fetches",
        kind: "other",
        status: "in_progress",
        _meta: { med: { tool: "Agent", background: { id: "a1", kind: "agent" } } },
      },
    },
    {
      at: 1100,
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("List each fetch path."),
        _meta: within("fetches"),
      },
    },
    {
      at: 1200,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text("Two paths fetch."),
        _meta: within("fetches"),
      },
    },
    {
      at: 2000,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tests",
        title: "Check the cache tests",
        kind: "other",
        status: "completed",
        _meta: { med: { tool: "Agent" } },
      },
    },
    {
      at: 2100,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text("The tests cover a stale cache."),
        _meta: within("tests"),
      },
    },
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} showWork />);
  const thread = page.getByRole("log", { name: "Session" });
  const tabs = page.getByRole("tablist", { name: "Session and subagents" });
  const tab = (name: string) => tabs.getByRole("tab", { name });
  const view = page.getByRole("region", { name: "Subagent" });
  // Each subagent has a tab beside the session's, which says whether it works.
  await expect
    .element(tabs)
    .toHaveTextContent("MainFind every place that fetchesCheck the cache tests");
  await expect.element(tab("Main")).toHaveAttribute("aria-selected", "true");
  await expect
    .element(tab("Find every place that fetches"))
    .toHaveAttribute("data-tooltip", "Find every place that fetches · Working");
  await expect
    .element(tab("Check the cache tests"))
    .toHaveAttribute("data-tooltip", "Check the cache tests · Done");

  await userEvent.click(tab("Find every place that fetches"));
  await expect.element(view.getByText("List each fetch path.")).toBeVisible();
  await expect.element(view.getByText("Two paths fetch.")).toBeVisible();
  await expect
    .element(tab("Find every place that fetches"))
    .toHaveAttribute("aria-selected", "true");
  // The session's thread waits beneath, out of reach of the keys.
  expect(thread.element().closest("[inert]")).not.toBeNull();

  // The arrow keys move between the tabs.
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(view.getByText("The tests cover a stale cache.")).toBeVisible();
  expect(document.activeElement).toBe(tab("Check the cache tests").element());
  await userEvent.keyboard("{Home}");
  await expect.element(view).not.toBeInTheDocument();
  await expect.element(tab("Main")).toHaveAttribute("aria-selected", "true");

  // Open on a subagent's row opens its tab; Escape goes back to the session.
  await userEvent.click(thread.getByRole("button", { name: "Open Check the cache tests" }));
  await expect.element(view.getByText("The tests cover a stale cache.")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(view).not.toBeInTheDocument();
  expect(thread.element().closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(threadScroller());

  // A subagent in the Background dock opens the same way.
  await userEvent.click(
    page.getByRole("region", { name: "Background tasks" }).getByRole("button", {
      name: "Find every place that fetches",
    }),
  );
  await expect.element(view.getByText("Two paths fetch.")).toBeVisible();
});

test("beside the side panel, the subagents are a list in its card, not tabs over the thread", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll(
    [
      ["fetches", "Find every place that fetches", "in_progress"],
      ["tests", "Check the cache tests", "completed"],
      ["types", "Tighten the cache types", "failed"],
    ].map(([id, title, status], at) => ({
      at: at * 1000,
      update: {
        sessionUpdate: "tool_call" as const,
        toolCallId: id!,
        title: title!,
        kind: "other" as const,
        status: status as "in_progress" | "completed" | "failed",
        _meta: { med: { tool: "Agent" } },
      },
    })),
  );
  const side = document.createElement("div");
  document.body.append(side);
  try {
    localStorage.removeItem("med:session-panel-cards");
    root!.render(<SessionThread snapshot={store.getSnapshot()} agentsIn={side} showWork />);
    // The card starts folded, with how many and how many work; its title opens it.
    const card = page.getByRole("region", { name: "Subagents" });
    await expect.element(card).toHaveTextContent("Subagents3 agents · 1 working");
    const toggle = card.getByRole("button", { name: "Subagents" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(0);
    await userEvent.click(toggle);
    const tabs = page.getByRole("tablist", { name: "Session and subagents" });
    await expect.element(tabs).toHaveAttribute("aria-orientation", "vertical");
    // The list is the card's, and the thread has no row of tabs over it.
    expect(side.contains(card.element())).toBe(true);
    expect(side.contains(tabs.element())).toBe(true);
    expect(document.querySelectorAll('[role="tablist"]')).toHaveLength(1);
    // Each row says how its subagent is doing, in words.
    await expect
      .element(tabs)
      .toHaveTextContent(
        "MainFind every place that fetchesWorkingCheck the cache testsDoneTighten the cache typesFailed",
      );
    await userEvent.click(tabs.getByRole("tab", { name: /Check the cache tests/ }));
    const view = page.getByRole("region", { name: "Subagent" });
    await expect.element(view).toBeVisible();
    // A list that stands, so the arrow keys go down and up it.
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(tabs.getByRole("tab", { name: /Tighten the cache types/ }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Home}");
    await expect.element(view).not.toBeInTheDocument();
  } finally {
    side.remove();
    localStorage.removeItem("med:session-panel-cards");
  }
});

test("hidden work keeps each reply: the one before med review wait, and one that ended a turn", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const text = (value: string) => ({ type: "text" as const, text: value });
  const prompt = (at: number, value: string) => ({
    at,
    update: { sessionUpdate: "user_message_chunk" as const, content: text(value) },
  });
  const reply = (at: number, id: string, value: string, endsTurn = false) => ({
    at,
    update: {
      sessionUpdate: "agent_message_chunk" as const,
      messageId: id,
      content: text(value),
      ...(endsTurn ? { _meta: { med: { endsTurn: true } } } : {}),
    },
  });
  const run = (at: number, id: string, title: string, command: string, background = false) => ({
    at,
    update: {
      sessionUpdate: "tool_call" as const,
      toolCallId: id,
      title,
      kind: "execute" as const,
      status: background ? ("in_progress" as const) : ("completed" as const),
      rawInput: { command },
      ...(background ? { _meta: { med: { background: { id, kind: "shell" as const } } } } : {}),
    },
  });
  const store = longThread(0);
  store.applyAll([
    prompt(0, "Format the durations."),
    run(1000, "build", "Build the summary", "bun run build"),
    reply(2000, "summary", "Durations read in minutes now."),
    run(2500, "wait", "Wait for the review", "med review wait --key durations", true),
    reply(2600, "waiting", "Waiting for your review.", true),
    prompt(10_000, "Start the server."),
    run(11_000, "server", "Start the server", "bun run dev"),
    reply(12_000, "up", "The server is up.", true),
    // A background task's report starts more work without a prompt.
    run(15_000, "log", "Read the server log", "tail server.log"),
    reply(16_000, "clean", "The log is clean.", true),
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const thread = page.getByRole("log", { name: "Session" });
  await expect.element(thread.getByText("Durations read in minutes now.")).toBeVisible();
  await expect.element(thread.getByText("Waiting for your review.")).toBeVisible();
  await expect.element(thread.getByText("The server is up.")).toBeVisible();
  await expect.element(thread.getByText("The log is clean.")).toBeVisible();
  // The work itself folds.
  await expect.element(thread.getByText("Read the server log")).not.toBeInTheDocument();
  expect(thread.getByRole("button", { name: /^Worked for/ }).elements()).toHaveLength(2);
});

test("a hand-off is a card in the conversation that opens its review, and stays when the work folds", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const text = (value: string) => ({ type: "text" as const, text: value });
  const run = (at: number, id: string, command: string, status: "in_progress" | "completed") => ({
    at,
    update: {
      sessionUpdate: "tool_call" as const,
      toolCallId: id,
      title: command,
      kind: "execute" as const,
      status,
      rawInput: { command },
    },
  });
  const store = longThread(0);
  store.applyAll([
    {
      at: 0,
      update: { sessionUpdate: "user_message_chunk" as const, content: text("Rename it.") },
    },
    run(1000, "build", "bun run build", "completed"),
    run(2000, "handoff", "med review create --key rename --guide guide.json", "in_progress"),
  ]);
  let opened = 0;
  const review = { title: "Rename the export", open: () => (opened += 1) };
  const show = () =>
    root!.render(
      <HandoffContext.Provider value={review}>
        <SessionThread snapshot={store.getSnapshot()} />
      </HandoffContext.Provider>,
    );
  show();
  const thread = page.getByRole("log", { name: "Session" });
  // While the agent writes it, the card is dashed and does not open.
  const writing = thread.getByRole("button", { name: "Handing off Rename the export" });
  await expect.element(writing).toBeDisabled();
  store.applyAll([
    run(2000, "handoff", "med review create --key rename --guide guide.json", "completed"),
    {
      at: 3000,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "done",
        content: text("The review is ready."),
        _meta: { med: { endsTurn: true } },
      },
    },
  ]);
  show();
  // The turn's work folds; the card stays, and opens the review.
  await expect.element(thread.getByRole("button", { name: /^Worked for/ })).toBeVisible();
  await expect.element(thread.getByText("bun run build")).not.toBeInTheDocument();
  const card = thread.getByRole("button", { name: "Open the review: Rename the export" });
  await expect.element(card).toBeVisible();
  await card.click();
  expect(opened).toBe(1);
});

test("[ and ] step through the prompts and replies of a focused thread", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(300);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r299");
  const current = () => document.querySelector<HTMLElement>("[data-current]")?.dataset.unit;
  threadScroller().focus();
  // From the end, the latest reply first, then up through the messages.
  await userEvent.keyboard("[[");
  expect(current()).toBe("r299");
  await userEvent.keyboard("[[[[[[");
  expect(document.querySelector("[data-current]")!.textContent).toContain("Prompt 298");
  await userEvent.keyboard("]");
  await expect.poll(current).toBe("r298");
  // Far from the end, the message goes near the top of the view.
  for (let step = 0; step < 20; step++) await userEvent.keyboard("[[");
  await expect.poll(() => Math.round(topOf(current()!))).toBe(16);
  // The mark is for the keys: a click in the thread takes it away.
  await userEvent.click(document.querySelector(`[data-unit="${current()}"]`)!);
  expect(current()).toBeUndefined();
});

test("{ and } step through the prompts, and { goes on to one on a page not yet loaded", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  // The thread holds turns 5 to 7; the session's index also lists turn 4.
  const store = longThread(3, 5);
  const asked: number[] = [];
  root!.render(
    <SessionThread
      snapshot={store.getSnapshot()}
      turns={[
        { offset: 0, at: 4000, text: "Prompt 4" },
        { offset: 900, at: 5000, text: "Prompt 5" },
      ]}
      onTurn={(turn) => asked.push(turn.offset)}
    />,
  );
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r7");
  const current = () => document.querySelector<HTMLElement>("[data-current]")?.textContent;
  threadScroller().focus();
  await userEvent.keyboard("{{");
  await expect.poll(current).toContain("Prompt 7");
  await userEvent.keyboard("{{{{");
  await expect.poll(current).toContain("Prompt 5");
  await userEvent.keyboard("}");
  await expect.poll(current).toContain("Prompt 6");
  expect(asked).toEqual([]);
  // Before the first loaded prompt, the thread asks for the one before it.
  await userEvent.keyboard("{{{{");
  await expect.poll(() => asked).toEqual([0]);
});

test("the place pill names the request that the view is in, fades at rest, and goes to another", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  // The thread holds turns 5 to 44; the session's index also lists turn 4.
  const store = longThread(40, 5);
  const asked: number[] = [];
  root!.render(
    <SessionThread
      snapshot={store.getSnapshot()}
      turns={[
        { offset: 0, at: 4000, text: "Prompt 4" },
        { offset: 900, at: 5000, text: "Prompt 5" },
      ]}
      onTurn={(turn) => asked.push(turn.offset)}
    />,
  );
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r44");
  const pill = () => document.querySelector<HTMLElement>("[data-place-pill]");
  const shows = () => (pill() ? getComputedStyle(pill()!).opacity !== "0" : false);
  // At the end, which the view follows, the reader knows the place.
  expect(pill()).toBeNull();
  // The request that the view is in: the last one that ended above its top.
  const above = () => {
    const top = threadScroller().getBoundingClientRect().top;
    const passed = [...document.querySelectorAll<HTMLElement>('[data-message="user"]')].filter(
      (message) => message.getBoundingClientRect().bottom <= top + 4,
    );
    return Number(/Prompt (\d+)/.exec(passed.at(-1)?.textContent ?? "")?.[1]);
  };
  // Up in the thread, under a request that has left the view's top. The
  // wheel is the reader's own move, which lets go of the end.
  const wheel = (by: number) => {
    threadScroller().dispatchEvent(new WheelEvent("wheel", { deltaY: by, bubbles: true }));
    threadScroller().scrollTop += by;
  };
  wheel(-1500);
  await expect.poll(() => pill()?.textContent).toMatch(/^\d+ of 41Prompt \d+$/);
  await expect.poll(() => pill()?.textContent).toBe(`${above() - 3} of 41Prompt ${above()}`);
  expect(shows()).toBe(true);
  expect(pill()!.getAttribute("aria-label")).toContain(`of 41: Prompt ${above()}`);
  // A second after the scrolling stops, it fades.
  await expect.poll(shows, { timeout: 3000 }).toBe(false);
  // The next scroll shows it again, with the request there.
  wheel(-300);
  await expect.poll(shows).toBe(true);
  await expect.poll(() => pill()?.textContent).toBe(`${above() - 3} of 41Prompt ${above()}`);
  // A click lists every request, the one in view marked; a choice goes there.
  await userEvent.click(pill()!);
  const list = page.getByRole("menu", { name: "The thread's requests" });
  await expect.element(list).toBeVisible();
  expect(list.element().querySelectorAll("button")).toHaveLength(41);
  expect(list.element().querySelector('[aria-current="true"]')?.textContent).toBe(
    pill()!.textContent!.replace(/ of 41/, ""),
  );
  await userEvent.click(list.getByRole("menuitem", { name: "22 Prompt 25" }));
  await expect.element(list).not.toBeInTheDocument();
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-current]")?.textContent)
    .toContain("Prompt 25");
  // The first of the list is on a page that has not loaded: the thread asks for it.
  await userEvent.click(pill()!);
  await userEvent.click(list.getByRole("menuitem", { name: "1 Prompt 4" }));
  expect(asked).toEqual([0]);
});

test("a prompt shows its quotes as Claude does, without reply markers", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: {
          type: "text" as const,
          text: "<!-- reply 1 -->\n> Pins keep adding to the notes.\n\nThis makes sense.\n\n<!-- reply 2 -->\n> Show the prompt.\n> Add one switch.\n\nYes.",
        },
      },
    },
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const bubble = () => document.querySelector('[data-message="user"]');
  await expect.poll(() => bubble()?.querySelectorAll("blockquote").length).toBe(2);
  expect([...bubble()!.querySelectorAll("blockquote")].map((quote) => quote.textContent)).toEqual([
    "Pins keep adding to the notes.",
    "Show the prompt.\nAdd one switch.",
  ]);
  expect([...bubble()!.querySelectorAll("p")].map((text) => text.textContent)).toEqual([
    "This makes sense.",
    "Yes.",
  ]);
  expect(bubble()!.textContent).not.toMatch(/<!--|>/);
});

test("a prompt's images are square thumbnails, and a click shows one at full size", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  // Two wide images, as screenshots are.
  const image = (color: string) => ({
    type: "image" as const,
    mimeType: "image/svg+xml",
    data: btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="${color}"/></svg>`,
    ),
  });
  store.applyAll(
    [
      image("#3b82f6"),
      image("#f97316"),
      { type: "text" as const, text: "Why do these differ?" },
    ].map((content) => ({
      at: 0,
      update: { sessionUpdate: "user_message_chunk" as const, content },
    })),
  );
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const first = page.getByRole("button", { name: "Show image 1" });
  await expect.element(first).toBeVisible();
  const box = first.element().getBoundingClientRect();
  expect([box.width, box.height]).toEqual([64, 64]);
  expect(
    page.getByText("Why do these differ?").element().getBoundingClientRect().top,
  ).toBeGreaterThan(box.bottom);

  await first.click();
  const viewer = page.getByRole("dialog", { name: "Image 1 of 2" });
  await expect.element(viewer).toBeVisible();
  expect(viewer.element().querySelector("img")!.getBoundingClientRect().width).toBeGreaterThan(400);
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByRole("dialog", { name: "Image 2 of 2" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("a reply's links act as links, and a web link shows its site's icon", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        content: {
          type: "text" as const,
          text: "See [summary.ts:14](src/summary.ts:14), the [Docs](https://react.dev/reference/react/useMemo), the [Review](https://github.acme.dev/trail/pull/7), and the [Wiki](https://wiki.trail.dev/b).",
        },
      },
    },
  ]);
  const opened: string[] = [];
  root!.render(
    <SessionThread snapshot={store.getSnapshot()} onOpenLink={(href) => opened.push(href)} />,
  );
  const docs = page.getByRole("link", { name: "Docs" });
  await expect.element(docs).toHaveAttribute("href", "https://react.dev/reference/react/useMemo");
  // The icon is the site's favicon, which Med holds; it asks no server for it.
  const image = (link: Element) => link.querySelector<HTMLImageElement>("img")!;
  expect(docs.element().getAttribute("data-site")).toBe("react");
  await expect.poll(() => image(docs.element()).naturalWidth).toBeGreaterThan(0);
  expect(new URL(image(docs.element()).src).origin).toBe(location.origin);
  // A company's own server matches by a word in its name; any other site shows a globe.
  expect(page.getByRole("link", { name: "Review" }).element().getAttribute("data-site")).toBe(
    "github",
  );
  expect(page.getByRole("link", { name: "Wiki" }).element().getAttribute("data-site")).toBe("web");
  // The icon is shorter than its pill.
  const pill = docs.element().getBoundingClientRect();
  const icon = image(docs.element()).getBoundingClientRect();
  expect(icon.top).toBeGreaterThan(pill.top);
  expect(icon.bottom).toBeLessThan(pill.bottom);

  // A file link has no href, but it has the link cursor and underlines on hover.
  const file = page.getByText("summary.ts:14");
  expect(getComputedStyle(file.element()).cursor).toBe("pointer");
  expect(getComputedStyle(file.element()).textDecorationLine).toBe("none");
  await userEvent.hover(file);
  await expect.poll(() => getComputedStyle(file.element()).textDecorationLine).toBe("underline");
  await userEvent.click(file);
  expect(opened).toEqual(["src/summary.ts:14"]);
});

test("a finished turn's work folds into one row that opens in place, and Show work opens every turn", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  store.applyAll(
    [0, 1].flatMap((turn) => {
      const at = turn * 10_000;
      const text = (id: string, value: string, offset: number) => ({
        at: at + offset,
        update: {
          sessionUpdate: "agent_message_chunk" as const,
          messageId: id,
          content: { type: "text" as const, text: value },
        },
      });
      return [
        {
          at,
          update: {
            sessionUpdate: "user_message_chunk" as const,
            content: { type: "text" as const, text: `Prompt ${turn}` },
          },
        },
        text(`c${turn}`, `I will run the tests ${turn}.`, 1000),
        {
          at: at + 2000,
          update: {
            sessionUpdate: "tool_call" as const,
            toolCallId: `run-${turn}`,
            title: `Run the tests ${turn}`,
            kind: "execute" as const,
            status: "completed" as const,
            rawInput: { command: "bun test" },
          },
        },
        text(`f${turn}`, `The tests ${turn} pass.`, 4000),
      ];
    }),
  );
  const render = (showWork?: boolean) =>
    root!.render(<SessionThread snapshot={store.getSnapshot()} showWork={showWork} />);
  render();
  const rows = page.getByRole("button", { name: /^Worked for 4s · 1 tool call$/ });
  await expect.poll(() => rows.elements().length).toBe(2);
  await expect.element(page.getByText("The tests 1 pass.")).toBeVisible();
  // The prompt and the final reply show; the commentary and the call fold.
  expect(page.getByText("I will run the tests 0.").query()).toBeNull();
  expect(page.getByRole("button", { name: /Run the tests/ }).query()).toBeNull();

  const first = rows.nth(0);
  const top = first.element().getBoundingClientRect().top;
  await userEvent.click(first);
  await expect.element(first).toHaveAttribute("aria-expanded", "true");
  await expect.element(page.getByRole("button", { name: /Run the tests 0/ })).toBeVisible();
  await expect.element(page.getByText("I will run the tests 0.")).toBeVisible();
  expect(Math.abs(first.element().getBoundingClientRect().top - top)).toBeLessThan(2);
  expect(page.getByRole("button", { name: /Run the tests 1/ }).query()).toBeNull();

  render(true);
  await expect.element(page.getByRole("button", { name: /Run the tests 1/ })).toBeVisible();
  await expect.element(page.getByRole("button", { name: /Run the tests 0/ })).toBeVisible();
  // A turn closes against the switch too.
  await userEvent.click(rows.nth(1));
  await expect.element(rows.nth(1)).toHaveAttribute("aria-expanded", "false");
  expect(page.getByRole("button", { name: /Run the tests 1/ }).query()).toBeNull();

  // The turn that runs keeps its work in view, with a prompt queued behind it.
  store.applyAll([
    {
      at: 30_000,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: { type: "text" as const, text: "Prompt 2" },
      },
    },
    {
      at: 31_000,
      update: {
        sessionUpdate: "tool_call" as const,
        toolCallId: "run-2",
        title: "Run the tests 2",
        kind: "execute" as const,
        status: "in_progress" as const,
      },
    },
    {
      at: 32_000,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: { type: "text" as const, text: "Then the docs." },
        _meta: { med: { queued: true } },
      },
    },
  ]);
  root!.render(<SessionThread snapshot={{ ...store.getSnapshot(), running: true }} />);
  await expect.element(page.getByText("Then the docs.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: /Run the tests 2/ })).toBeVisible();
  expect(rows.elements()).toHaveLength(2);

  // When it ends, its work folds before the note, and one row says how long it took.
  store.applyAll([
    {
      at: 34_000,
      update: {
        sessionUpdate: "tool_call_update" as const,
        toolCallId: "run-2",
        status: "completed" as const,
      },
    },
    {
      at: 36_000,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "final-2",
        content: { type: "text" as const, text: "Tests pass, and the docs say so." },
      },
    },
  ]);
  root!.render(<SessionThread snapshot={{ ...store.getSnapshot(), running: false }} />);
  await expect.element(page.getByText("Tests pass, and the docs say so.")).toBeVisible();
  await expect.element(page.getByText("Then the docs.")).toBeVisible();
  expect(page.getByRole("button", { name: /Run the tests 2/ }).query()).toBeNull();
  expect(page.getByText(/^Worked for 6s/).elements()).toHaveLength(1);
});

test("a message from Med joins the thread where the agent took it, so the turn before keeps its reply", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  const text = (sessionUpdate: string, value: string, at: number, messageId?: string) => ({
    at,
    update: {
      sessionUpdate,
      ...(messageId ? { messageId } : {}),
      content: { type: "text", text: value },
    },
  });
  store.applyAll([
    text("user_message_chunk", "Fix the export.", 0),
    text("agent_message_chunk", "Looking at the export.", 1000, "a"),
    {
      at: 2000,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "test",
        title: "Run the tests",
        kind: "execute",
        status: "completed",
      },
    },
    text("agent_message_chunk", "The export keeps the old format.", 8000, "b"),
  ] as Parameters<typeof store.applyAll>[0]);
  // Sent while the agent worked; the agent took it once it waited again.
  const message = (delivery: SentMessage["delivery"]): SentMessage => ({
    id: "m1",
    sessionId: "s1",
    agent: "claude",
    text: "Also check the import.",
    noteIds: [],
    attachmentCount: 0,
    createdAt: new Date(4000).toISOString(),
    delivery,
    ...(delivery === "delivered" ? { deliveredAt: new Date(9000).toISOString() } : {}),
  });
  const render = (delivery: SentMessage["delivery"]) => {
    const snapshot = store.getSnapshot();
    root!.render(
      <SessionThread
        snapshot={{ ...snapshot, items: withSentMessages(snapshot.items, [message(delivery)]) }}
      />,
    );
  };
  for (const delivery of ["pending", "delivered"] as const) {
    render(delivery);
    await expect.element(page.getByText("Also check the import.")).toBeVisible();
    // The turn's work folds, and its reply stays in view above the message.
    await expect.element(page.getByText("The export keeps the old format.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: /^Worked for 8s/ })).toBeVisible();
    expect(page.getByText("Looking at the export.").query()).toBeNull();
    const reply = page.getByText("The export keeps the old format.").element();
    const sent = page.getByText("Also check the import.").element();
    expect(reply.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  await expect.element(page.getByText("Waiting for Claude to take it")).not.toBeInTheDocument();
});

test("a message sent from Med keeps its row when the transcript has it, and rises in once", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  const text = (sessionUpdate: string, value: string, at: number, messageId?: string) => ({
    at,
    update: {
      sessionUpdate,
      ...(messageId ? { messageId } : {}),
      content: { type: "text", text: value },
    },
  });
  store.applyAll([
    text("user_message_chunk", "Fix the export.", 0),
    text("agent_message_chunk", "Done.", 1000, "a"),
  ] as Parameters<typeof store.applyAll>[0]);
  const sent: SentMessage = {
    id: "m1",
    sessionId: "s1",
    agent: "claude",
    text: "Also check the import.",
    noteIds: [],
    attachmentCount: 0,
    createdAt: new Date(4000).toISOString(),
    delivery: "sending",
  };
  const render = (message: SentMessage) => {
    const snapshot = store.getSnapshot();
    root!.render(
      <SessionThread
        snapshot={{ ...snapshot, items: withSentMessages(snapshot.items, [message]) }}
      />,
    );
  };
  const row = () =>
    page.getByText("Also check the import.").element().closest<HTMLElement>("[data-unit]")!;
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.element(page.getByText("Done.")).toBeVisible();
  render(sent);
  await expect.element(page.getByText("Also check the import.")).toBeVisible();
  const first = row();
  // It rises in as it is sent, once.
  expect(first.dataset.rise).toBe("");
  const rising = new Set(first.getAnimations());
  expect(rising.size).toBe(1);
  // Med has it, then the transcript does: the same row, and no second rise.
  await expect.element(page.getByText("Sending…")).toBeVisible();
  render({ ...sent, delivery: "delivered", deliveredAt: new Date(4100).toISOString() });
  await expect.element(page.getByText("Sending…")).not.toBeInTheDocument();
  expect(row()).toBe(first);
  expect(first.dataset.rise).toBeUndefined();
  store.applyAll([text("user_message_chunk", "Also check the import.", 4200)] as Parameters<
    typeof store.applyAll
  >[0]);
  render({ ...sent, delivery: "delivered", deliveredAt: new Date(4100).toISOString() });
  // The transcript's copy carries Med's message: the row's time is the
  // transcript's now.
  const frames = () =>
    new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  await frames();
  expect(page.getByText("Also check the import.").elements()).toHaveLength(1);
  expect(row()).toBe(first);
  expect(first.isConnected).toBe(true);
  expect(first.dataset.rise).toBeUndefined();
  // No animation but the first rise.
  expect(
    first.getAnimations({ subtree: true }).filter((animation) => !rising.has(animation)),
  ).toEqual([]);
});

test("an edit shows its file and line counts, and its diff when the reader opens it", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = createSessionStore();
  store.applyAll(
    Array.from({ length: 80 }, (_, turn) => ({
      at: turn * 1000,
      update: {
        sessionUpdate: "tool_call" as const,
        toolCallId: `edit-${turn}`,
        title: `Edit file-${turn}.ts`,
        kind: "edit" as const,
        status: "completed" as const,
        content: [
          {
            type: "diff" as const,
            path: `/repo/file-${turn}.ts`,
            oldText: `export const value = ${turn};\n`,
            newText: `export const value = ${turn + 1};\nexport const next = ${turn + 2};\n`,
          },
        ],
      },
    })),
  );
  frame({ height: "600px" }).render(<SessionThread snapshot={store.getSnapshot()} showWork />);
  const row = () => document.querySelector<HTMLButtonElement>('[data-unit="edit-79"] button')!;
  await expect.poll(() => row()?.textContent).toContain("file-79.ts");
  expect(row().textContent).toContain("+2");
  expect(row().textContent).toContain("−1");
  expect(row().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector("[data-unit] figure")).toBeNull();

  await userEvent.click(row());
  await expect.poll(() => document.querySelector('[data-unit="edit-79"] figure')).not.toBeNull();
  expect(document.querySelectorAll("[data-unit] figure")).toHaveLength(1);
});

test("a long prompt shows its first lines until Show more, and Show less folds it again; the rest renders only when open", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const text = (value: string) => ({ type: "text" as const, text: value });
  const prompt = (at: number, value: string) => ({
    at,
    update: { sessionUpdate: "user_message_chunk" as const, content: text(value) },
  });
  const reply = (at: number, id: string, value: string) => ({
    at,
    update: {
      sessionUpdate: "agent_message_chunk" as const,
      messageId: id,
      content: text(value),
      _meta: { med: { endsTurn: true } },
    },
  });
  const long = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of the brief.`);
  const store = longThread(0);
  store.applyAll([
    prompt(0, long.join("\n")),
    reply(1000, "read", "I read the brief."),
    prompt(2000, "A short prompt."),
    reply(3000, "short", "Done."),
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const thread = page.getByRole("log", { name: "Session" });
  const toggle = thread.getByRole("button", { name: /^Show (more|less)$/ });
  await expect.element(toggle).toHaveTextContent("Show more");
  // Only the long prompt folds.
  expect(toggle.elements()).toHaveLength(1);
  const body = thread.getByText(/^Line 1 of the brief/).element().parentElement!;
  expect(body.clientHeight).toBeLessThan(body.scrollHeight);
  // The lines past the fold do not lay out while it is folded.
  expect(body.textContent).not.toContain("Line 40");

  // Opening keeps the prompt's top in place.
  const top = body.getBoundingClientRect().top;
  await userEvent.click(toggle);
  await expect.element(toggle).toHaveTextContent("Show less");
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  expect(body.textContent).toContain("Line 40 of the brief.");
  expect(body.clientHeight).toBe(body.scrollHeight);
  expect(Math.abs(body.getBoundingClientRect().top - top)).toBeLessThan(2);

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveTextContent("Show more");
  expect(body.clientHeight).toBeLessThan(body.scrollHeight);
  expect(body.textContent).not.toContain("Line 40");
});

test("a long prompt stays folded, though the first lines it shows measure under the fold", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const text = (value: string) => ({ type: "text" as const, text: value });
  const store = longThread(0);
  // A blank line after the first sixteen, as in pasted code: the fold's text
  // ends there, so it shows sixteen lines and measures just under the fold.
  const lines = Array.from({ length: 40 }, (_, index) => (index === 16 ? "" : `Line ${index + 1}`));
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: text(lines.join("\n")),
      },
    },
    {
      at: 1000,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "read",
        content: text("I read it."),
        _meta: { med: { endsTurn: true } },
      },
    },
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const thread = page.getByRole("log", { name: "Session" });
  const toggle = thread.getByRole("button", { name: /^Show (more|less)$/ });
  await expect.element(toggle).toHaveTextContent("Show more");
  const body = thread.getByText(/^Line 1\b/).element().parentElement!;
  await afterFrames(5);
  // It does not open and fold again, frame after frame.
  let changes = 0;
  const watch = new MutationObserver((records) => (changes += records.length));
  watch.observe(thread.element(), {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  for (let frame = 0; frame < 20; frame++) {
    await nextFrame();
    expect(body.textContent).not.toContain("Line 40");
    expect(toggle.element().textContent).toBe("Show more");
  }
  watch.disconnect();
  expect(changes).toBe(0);
});

test("a running turn's time ticks in whole seconds from 1 s and in minutes from 10 minutes; its calls spin", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const shell = (at: number, id: string, title: string, background = false) => ({
    at,
    update: {
      sessionUpdate: "tool_call" as const,
      toolCallId: id,
      title,
      kind: "execute" as const,
      status: "in_progress" as const,
      rawInput: { command: "bun test" },
      ...(background ? { _meta: { med: { background: { id, kind: "shell" as const } } } } : {}),
    },
  });
  // A turn that started `ago` ms before now, on the real clock: no `now`.
  const working = (ago: number) => {
    root?.unmount();
    mount?.remove();
    const startedAt = Date.now() - ago;
    const store = longThread(0);
    store.applyAll([
      shell(startedAt - 2 * 60 * 60_000, "dev", "Start the dev server", true),
      shell(startedAt - 30_000, "styles", "Watch the styles", true),
      {
        at: startedAt,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: { type: "text" as const, text: "Run the tests." },
        },
      },
      shell(startedAt + 100, "tests", "Run the tests"),
    ]);
    store.setRunning(true);
    root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  };
  const time = () =>
    page.getByText("Working", { exact: true }).element().parentElement!.lastElementChild!;

  working(300);
  await expect.element(page.getByText("Working", { exact: true })).toBeVisible();
  // Nothing under a second, then whole seconds, each for a whole second.
  expect(time().textContent).toBe("");
  await expect.poll(() => time().textContent, { timeout: 2000 }).toBe("1s");
  await expect.poll(() => time().textContent, { timeout: 1500 }).toBe("2s");
  expect(getComputedStyle(time()).fontVariantNumeric).toContain("tabular-nums");
  // The view's one clock: a running call spins and shows no time.
  const call = page.getByRole("log").getByRole("button", { name: /Run the tests/ });
  await expect.element(call.getByLabelText("Running")).toBeInTheDocument();
  expect(call.element().textContent).not.toMatch(/\d+s\b/);
  // The dock counts minutes: a dev server does not tick seconds.
  const dock = page.getByRole("region", { name: "Background tasks" });
  await expect.element(dock.getByText("2h 00m", { exact: true })).toBeVisible();
  await expect.element(dock.getByText("Running", { exact: true })).toBeVisible();

  working(59_300);
  await expect.poll(() => time().textContent).toBe("59s");
  await expect.poll(() => time().textContent, { timeout: 1500 }).toBe("1m 00s");

  working(9 * 60_000 + 59_300);
  await expect.poll(() => time().textContent).toBe("9m 59s");
  await expect.poll(() => time().textContent, { timeout: 1500 }).toBe("10 min");

  working(65 * 60_000);
  await expect.poll(() => time().textContent).toBe("1h 05m");
  expect(document.body.textContent).not.toMatch(/\d\.\d+s\b/);
});

test("a reply's actions show on hover and focus, the latest reply's stay, and a prompt has Copy", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(2);
  const forks: string[] = [];
  let failNext = false;
  const actions: ReplyActions = {
    fork: async (item) => {
      if (failNext) throw new Error("The session has no such message.");
      forks.push(item.id);
    },
  };
  root!.render(
    <ReplyActionsContext.Provider value={actions}>
      <SessionThread snapshot={store.getSnapshot()} />
    </ReplyActionsContext.Provider>,
  );
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-unit="${id}"] [data-message-actions]`)!;
  const shown = (element: Element) => getComputedStyle(element).opacity === "1";
  await expect.poll(() => row("r1")).toBeTruthy();
  // The latest reply's actions stay; an earlier one's wait for the pointer.
  expect(shown(row("r1"))).toBe(true);
  await expect.poll(() => shown(row("r0"))).toBe(false);
  await userEvent.hover(page.getByText("Reply 0.", { exact: false }));
  await expect.poll(() => shown(row("r0"))).toBe(true);
  // Copy, Fork from here, and when the reply came, which says how long ago.
  const earlier = page.elementLocator(row("r0"));
  await expect.element(earlier.getByRole("button", { name: "Copy reply" })).toBeInTheDocument();
  expect(row("r0").querySelector("time")?.textContent).toMatch(/ago$/);
  // The keyboard reaches them: the focus shows the row.
  await userEvent.unhover(page.getByText("Reply 0.", { exact: false }));
  (row("r0").querySelector("button") as HTMLButtonElement).focus();
  await expect.poll(() => shown(row("r0"))).toBe(true);
  // Its tooltip says what a fork does.
  const fork = earlier.getByRole("button", { name: "Fork from here" });
  await expect
    .element(fork)
    .toHaveAttribute(
      "data-tooltip-detail",
      "Starts a new session from\nthis point. This one stays as it is.",
    );
  await userEvent.click(fork);
  expect(forks).toEqual(["r0"]);
  // A fork that fails says why, in the row.
  failNext = true;
  await userEvent.click(fork);
  await expect
    .poll(() => row("r0").querySelector('[role="alert"]')?.textContent)
    .toMatch(/no such message/);

  // A prompt has Copy beside its bubble, which copies its text.
  const prompt = document.querySelector<HTMLElement>('[data-message="user"]')!;
  await userEvent.hover(page.elementLocator(prompt).getByText("Prompt 0"));
  const copy = page.elementLocator(prompt).getByRole("button", { name: "Copy prompt" });
  await expect.poll(() => shown(prompt.querySelector("[data-message-actions]")!)).toBe(true);
  // The bubble's height is the text's: the button takes no room in it.
  const bubble = prompt.querySelector("p")!.parentElement!.parentElement!;
  expect(copy.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    bubble.getBoundingClientRect().left + 1,
  );
});

test("a reply in a comment's thread shows as the reply, under the answer it replies to", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  const sent: SentMessage = {
    id: "m1",
    sessionId: "s1",
    agent: "claude",
    text: "",
    noteIds: ["n1"],
    comments: [
      {
        path: "src/tides.ts",
        line: 12,
        text: "Use tideTimes, as the docs do.",
        inReplyTo: { author: "Claude", text: "Renamed it to tidesAt." },
      },
    ],
    attachmentCount: 0,
    createdAt: new Date(4000).toISOString(),
    delivery: "delivered",
  };
  const snapshot = store.getSnapshot();
  root!.render(
    <SessionThread snapshot={{ ...snapshot, items: withSentMessages(snapshot.items, [sent]) }} />,
  );
  await expect.element(page.getByText("Use tideTimes, as the docs do.")).toBeVisible();
  await expect.element(page.getByText("tides.ts:12 · reply to Claude")).toBeVisible();
  await expect.element(page.getByText("Renamed it to tidesAt.")).toBeVisible();
});

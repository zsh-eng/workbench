import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect } from "react";
import type { LivePullRequest } from "../../src/shared/protocol";
import { useLivePullRequest } from "../../src/web/data/live-pull-request";

// When the Pull request tab reads GitHub: a real hook on a real timer, with
// the clock advanced. Each read costs the sign-in's shared API limit.

const pull = (fields: Partial<LivePullRequest> = {}): LivePullRequest => ({
  url: "https://github.com/acme/app/pull/7",
  number: 7,
  title: "Rename",
  author: "mira",
  state: "open",
  body: "",
  base: "main",
  head: "feature",
  labels: [],
  checks: [],
  reviewers: [],
  merge: { mergeable: "MERGEABLE", status: "CLEAN", decision: null },
  fetchedAt: 0,
  ...fields,
});
const running = pull({
  checks: [
    {
      id: "CI/test",
      name: "test",
      outcome: "pending",
      state: "IN_PROGRESS",
      startedAt: null,
      completedAt: null,
    },
  ],
});

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let answer: () => Promise<LivePullRequest>;
const shown: { current?: { data: LivePullRequest | null; error: string | null } } = {};
let hidden = false;
let onScreen = true;
const load = vi.fn<(refresh: boolean) => Promise<LivePullRequest>>(() => answer());

function Reader({ active = true }: { active?: boolean }) {
  const state = useLivePullRequest(load, active, screen);
  useEffect(() => {
    shown.current = state;
  });
  return null;
}
const screen = () => onScreen;
const render = async (active = true) => {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  await act(async () => root!.render(<Reader active={active} />));
};
const pass = (milliseconds: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
const reads = () => load.mock.calls.length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  load.mockClear();
  hidden = false;
  onScreen = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() =>
    hidden ? "hidden" : "visible",
  );
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = mount = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

test("it reads every 30 seconds while a check runs, then every 2 minutes", async () => {
  answer = async () => running;
  await render();
  expect(reads()).toBe(1);
  await pass(29_000);
  expect(reads()).toBe(1);
  await pass(6_000);
  expect(reads()).toBe(2);
  answer = async () => pull();
  await pass(35_000);
  expect(reads()).toBe(3);
  await pass(105_000);
  expect(reads()).toBe(3);
  await pass(10_000);
  expect(reads()).toBe(4);
});

test("a merged pull request reads every 5 minutes", async () => {
  answer = async () => pull({ state: "merged" });
  await render();
  await pass(4 * 60_000);
  expect(reads()).toBe(1);
  await pass(65_000);
  expect(reads()).toBe(2);
});

test("a tab behind another, a hidden workspace, and a hidden window make no read", async () => {
  answer = async () => running;
  await render(false);
  await pass(10 * 60_000);
  expect(reads()).toBe(0);
  act(() => root!.render(<Reader />));
  expect(reads()).toBe(1);

  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  await pass(10 * 60_000);
  expect(reads()).toBe(1);
  // The first look after that reads, as the wait is over.
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(reads()).toBe(2);

  onScreen = false;
  await pass(10 * 60_000);
  expect(reads()).toBe(2);
  onScreen = true;
  await pass(6_000);
  expect(reads()).toBe(3);
});

test("failed reads wait twice as long each time and keep what the tab shows", async () => {
  answer = async () => running;
  await render();
  answer = async () => {
    throw new Error("HTTP 502");
  };
  await pass(35_000);
  expect(reads()).toBe(2);
  expect(shown.current).toMatchObject({ data: running, error: "HTTP 502" });
  await pass(35_000);
  expect(reads()).toBe(2);
  await pass(30_000);
  expect(reads()).toBe(3);
  answer = async () => running;
  await pass(125_000);
  expect(reads()).toBe(4);
  expect(shown.current).toMatchObject({ data: running, error: null });
});

test("a low API limit slows the reads, and an empty one waits until it fills", async () => {
  const start = Date.now();
  answer = async () =>
    pull({ ...running, budget: { remaining: 300, limit: 5000, resetAt: start + 3_600_000 } });
  await render();
  await pass(4 * 60_000);
  expect(reads()).toBe(1);
  answer = async () =>
    pull({ ...running, budget: { remaining: 0, limit: 5000, resetAt: start + 40 * 60_000 } });
  await pass(65_000);
  expect(reads()).toBe(2);
  await pass(30 * 60_000);
  expect(reads()).toBe(2);
  await pass(6 * 60_000);
  expect(reads()).toBe(3);
});

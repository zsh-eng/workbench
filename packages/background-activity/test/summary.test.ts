import { describe, expect, test } from "bun:test";
import {
  createActivityManager,
  describeJob,
  summarizeActivity,
  syncAsJob,
  type JobContext,
  type SyncStatusLike,
} from "../src/index";
import { deferred, FakeClock, FakeNetwork } from "./helpers";

function setup() {
  const clock = new FakeClock();
  const runs = new Map<
    string,
    { context: JobContext; done: ReturnType<typeof deferred> }
  >();
  const manager = createActivityManager({
    kinds: {
      book: {
        run(input: string, context: JobContext) {
          const done = deferred();
          runs.set(input, { context, done });
          return done.promise;
        },
      },
    },
    clock,
    network: new FakeNetwork(),
  });
  const summary = () => summarizeActivity(manager.getSnapshot(), clock.time);
  return { clock, runs, manager, summary };
}

describe("what shows", () => {
  test("work you asked for that ends within half a second never shows", async () => {
    const { clock, runs, manager, summary } = setup();
    manager.start("book", "emma", { id: "emma" });
    expect(summary().shown).toHaveLength(0);
    await clock.advance(300);
    runs.get("emma")!.done.resolve();
    await clock.advance(0);
    expect(summary().shown).toHaveLength(0);
    await clock.advance(1_000);
    expect(summary().shown).toHaveLength(0);
  });

  test("work you asked for shows after half a second and confirms once for 1.5 s", async () => {
    const { clock, runs, manager, summary } = setup();
    manager.start("book", "emma", { id: "emma" });
    expect(summary().nextChangeAt).toBe(clock.time + 500);
    await clock.advance(500);
    expect(summary().shown.map((job) => job.state)).toEqual(["running"]);
    runs.get("emma")!.done.resolve();
    await clock.advance(0);
    expect(summary().shown.map((job) => job.state)).toEqual(["done"]);
    await clock.advance(1_500);
    expect(summary().shown).toHaveLength(0);
  });

  test("work the app started stays quiet", async () => {
    const { clock, manager, summary } = setup();
    manager.start("book", "emma", { id: "emma", origin: "app" });
    await clock.advance(5_000);
    expect(summary().shown).toHaveLength(0);
    expect(summary().busy).toBe(true);
  });

  test("a failure stays until you retry or dismiss it, and needs you", async () => {
    const { clock, runs, manager, summary } = setup();
    manager.start("book", "emma", { id: "emma" });
    runs
      .get("emma")!
      .done.reject(Object.assign(new Error("Unauthorized"), { status: 401 }));
    await clock.advance(60_000);
    expect(summary().shown.map((job) => job.state)).toEqual(["failed"]);
    expect(summary().attention).toBe(true);
    expect(describeJob(summary().shown[0]!, clock.time)).toBe(
      "Sign in to download",
    );
    manager.dismiss("emma");
    expect(summary().shown).toHaveLength(0);
  });

  test("the progress together counts each shown book once", async () => {
    const { clock, runs, manager, summary } = setup();
    manager.start("book", "a", { id: "a" });
    manager.start("book", "b", { id: "b" });
    runs.get("a")!.context.progress({ bytes: 50, totalBytes: 100 });
    runs.get("b")!.context.progress({ bytes: 0, totalBytes: 100 });
    await clock.advance(600);
    expect(summary().fraction).toBe(0.25);
    expect(describeJob(manager.get("a")!, clock.time)).toBe(
      "In progress · 50 of 100 B",
    );
    runs.get("a")!.context.progress({
      phase: "downloading",
      bytes: 2_100_000,
      totalBytes: 4_600_000,
    });
    await clock.advance(100);
    expect(describeJob(manager.get("a")!, clock.time)).toBe(
      "Downloading · 2.1 of 4.6 MB",
    );
  });
});

describe("sync, as a tracked job", () => {
  function syncSource(status: Partial<SyncStatusLike>) {
    const value: SyncStatusLike = {
      connection: "online",
      auth: { status: "signed-in" },
      running: false,
      restoring: false,
      pending: 0,
      failure: null,
      failures: 0,
      retryAt: null,
      ...status,
    };
    return syncAsJob({ subscribe: () => () => {}, getSnapshot: () => value });
  }

  test("a restore shows half a second after it begins, however long the page has been open", async () => {
    const { clock, manager, summary } = setup();
    let status: SyncStatusLike = {
      connection: "online",
      auth: { status: "signed-in" },
      running: false,
      restoring: false,
      pending: 0,
      failure: null,
      failures: 0,
      retryAt: null,
    };
    const listeners = new Set<() => void>();
    manager.track(
      "sync",
      syncAsJob({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getSnapshot: () => status,
      }),
    );
    const set = (patch: Partial<SyncStatusLike>) => {
      status = { ...status, ...patch };
      listeners.forEach((listener) => listener());
    };
    const titles = () => summary().shown.map((job) => job.title);
    await clock.advance(5_000);
    set({ running: true, restoring: true });
    await clock.advance(300);
    expect(titles()).toEqual([]);
    set({ running: false, restoring: false });

    // A long wait for a sign-in, then a routine pass that
    // turns into a restore: it too begins when the restore does.
    set({ auth: { status: "signed-out" }, pending: 3 });
    await clock.advance(60_000);
    set({ auth: { status: "signed-in" }, running: true });
    set({ restoring: true });
    await clock.advance(300);
    expect(titles()).toEqual([]);
    await clock.advance(200);
    expect(titles()).toEqual(["Restoring your library"]);
  });

  test("a sync pass is silent, and so is a healthy idle sync", () => {
    expect(syncSource({ running: true }).read()).toMatchObject({
      state: "running",
      origin: "app",
    });
    expect(syncSource({}).read()).toBeNull();
  });

  test("a restore on a new device shows, because you are waiting for it", () => {
    expect(syncSource({ running: true, restoring: true }).read()).toMatchObject(
      {
        state: "running",
        origin: "user",
        title: "Restoring your library",
      },
    );
  });

  test("changes held offline wait quietly; held by a sign-out they need you", () => {
    expect(
      syncSource({ connection: "offline", pending: 3 }).read(),
    ).toMatchObject({
      state: "waiting",
      waitingFor: "network",
      detail: "3 changes saved on this device",
    });
    expect(
      syncSource({ auth: { status: "expired" }, pending: 1 }).read(),
    ).toMatchObject({
      state: "waiting",
      waitingFor: "sign-in",
      attention: true,
      detail: "1 change only on this device. Sign in to keep them.",
    });
  });

  test("one failure is a blip; two in a row show with the retry", () => {
    expect(
      syncSource({
        failure: { kind: "network" },
        failures: 1,
        retryAt: 1,
      }).read(),
    ).toBeNull();
    expect(
      syncSource({
        failure: { kind: "network" },
        failures: 2,
        retryAt: 1,
        connection: "unreachable",
      }).read(),
    ).toMatchObject({
      state: "retrying",
      attention: true,
      detail: "Couldn't reach the server",
    });
  });
});

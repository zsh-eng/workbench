import { describe, expect, test } from "bun:test";
import {
  createActivityManager,
  JobError,
  type ActivityManagerOptions,
  type JobContext,
  type JobKinds,
} from "../src/index";
import { deferred, FakeClock, FakeNetwork, MemoryStorage } from "./helpers";

/** A download whose attempts the test finishes by hand. */
function controllable() {
  const runs: {
    input: string;
    context: JobContext;
    done: ReturnType<typeof deferred>;
    settled: boolean;
  }[] = [];
  const kind = {
    persist: true,
    title: (input: string) => `Book ${input}`,
    retry: { attempts: 3, initialMs: 1_000, maxMs: 8_000 },
    run(input: string, context: JobContext) {
      const done = deferred();
      const run = { input, context, done, settled: false };
      runs.push(run);
      return done.promise.finally(() => {
        run.settled = true;
      });
    },
  };
  const running = () =>
    runs
      .filter((run) => !run.context.signal.aborted && !run.settled)
      .map((run) => run.input);
  const last = (input: string) =>
    [...runs].reverse().find((run) => run.input === input)!;
  return { kind, runs, running, last };
}

function setup<K extends JobKinds>(
  kinds: K,
  options: Partial<ActivityManagerOptions<K>> = {},
) {
  const clock = new FakeClock();
  const network = new FakeNetwork();
  const storage = new MemoryStorage();
  const make = () =>
    createActivityManager({
      kinds,
      clock,
      network,
      random: () => 1,
      persist: { storage, key: "jobs" },
      ...options,
    });
  return { clock, network, storage, make, manager: make() };
}

const state = (
  manager: { get(id: string): { state: string } | undefined },
  id: string,
) => manager.get(id)?.state;

describe("a job for each subject", () => {
  test("starting the same book twice joins the first job", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "book:emma" });
    manager.start("book", "emma", { id: "book:emma" });
    await clock.advance(0);
    expect(book.runs).toHaveLength(1);
    expect(manager.getSnapshot().jobs.map((job) => job.id)).toEqual([
      "book:emma",
    ]);
  });

  test("work the app started becomes yours when you ask for it", async () => {
    const book = controllable();
    const { manager } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "book:emma", origin: "app" });
    manager.start("book", "emma", { id: "book:emma", origin: "user" });
    expect(manager.get("book:emma")?.origin).toBe("user");
  });
});

describe("the queue", () => {
  test("a lane runs its limit at once, your jobs before the app's", async () => {
    const book = controllable();
    const { manager, clock } = setup(
      { book: { ...book.kind, lane: "network" } },
      { lanes: { network: 2 } },
    );
    manager.start("book", "a", { id: "a", origin: "app" });
    manager.start("book", "b", { id: "b", origin: "app" });
    manager.start("book", "c", { id: "c", origin: "app" });
    manager.start("book", "mine", { id: "mine", origin: "user" });
    expect(book.running()).toEqual(["a", "b"]);
    book.last("a").done.resolve();
    await clock.advance(0);
    expect(state(manager, "a")).toBe("done");
    // The free slot goes to the job you asked for, though it came last.
    expect(book.running()).toEqual(["b", "mine"]);
    expect(state(manager, "c")).toBe("queued");
  });

  test("progress reaches the snapshot, at most every 100 ms", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    let publishes = 0;
    manager.subscribe(() => publishes++);
    const { context } = book.last("emma");
    for (let bytes = 1; bytes <= 50; bytes++)
      context.progress({ bytes, totalBytes: 100 });
    await clock.advance(0);
    expect(manager.get("emma")?.progress.bytes).toBe(50);
    expect(publishes).toBe(1);
    context.progress({ bytes: 60 });
    await clock.advance(50);
    expect(manager.get("emma")?.progress.bytes).toBe(50);
    await clock.advance(50);
    expect(manager.get("emma")?.progress.bytes).toBe(60);
  });

  test("a held queue starts nothing until it resumes", async () => {
    const book = controllable();
    const { manager } = setup({ book: book.kind }, { paused: true });
    manager.start("book", "emma", { id: "emma" });
    expect(book.runs).toHaveLength(0);
    expect(state(manager, "emma")).toBe("queued");
    manager.resume();
    expect(book.running()).toEqual(["emma"]);
  });
});

describe("offline", () => {
  test("losing the network stops network work, and it starts again when the network returns", async () => {
    const book = controllable();
    const { manager, network, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    manager.start("book", "persuasion", { id: "persuasion" });
    manager.start("book", "sanditon", { id: "sanditon" });
    network.set(false);
    expect(book.running()).toEqual([]);
    expect(manager.getSnapshot().jobs.map((job) => job.state)).toEqual([
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(manager.get("emma")?.waitingFor).toBe("network");
    // The stopped attempt ends late; it changes nothing.
    book.last("emma").done.resolve();
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("waiting");
    network.set(true);
    expect(book.running()).toEqual(["emma", "persuasion"]);
    expect(state(manager, "sanditon")).toBe("queued");
  });

  test("the next download does not start once a request has shown the device is offline", async () => {
    // Bug 1 in docs/STATES.md, step by step.
    const book = controllable();
    const { manager, network, clock } = setup(
      { book: { ...book.kind, lane: "network" } },
      { lanes: { network: 1 } },
    );
    manager.start("book", "emma", { id: "emma" });
    manager.start("book", "persuasion", { id: "persuasion" });
    // The network drops; the browser has not sent its event yet.
    network.online = false;
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("waiting");
    expect(state(manager, "persuasion")).toBe("waiting");
    expect(book.running()).toEqual([]);
    network.set(true);
    expect(book.running()).toEqual(["emma"]);
  });

  test("a job started offline waits for the network", () => {
    const book = controllable();
    const { manager, network } = setup({ book: book.kind });
    network.set(false);
    manager.start("book", "emma", { id: "emma" });
    expect(state(manager, "emma")).toBe("waiting");
    expect(book.runs).toHaveLength(0);
  });

  test("a request that fails because the device went offline uses no retry", async () => {
    const book = controllable();
    const { manager, network, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    // The request fails before the browser's offline event arrives.
    network.online = false;
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("waiting");
    expect(manager.get("emma")?.attempts).toBe(0);
    network.set(true);
    expect(book.running()).toEqual(["emma"]);
  });
});

describe("failures", () => {
  test("a retryable failure retries with backoff, gives up after its attempts, and Retry starts again", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("retrying");
    expect(manager.get("emma")?.retryAt).toBe(clock.time + 1_000);
    await clock.advance(999);
    expect(book.runs).toHaveLength(1);
    await clock.advance(1);
    expect(book.runs).toHaveLength(2);
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(2_000);
    expect(book.runs).toHaveLength(3);
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("failed");
    expect(manager.get("emma")?.failure?.reason).toBe("network");
    await clock.advance(60_000);
    expect(book.runs).toHaveLength(3);
    manager.retry("emma");
    expect(state(manager, "emma")).toBe("running");
    expect(manager.get("emma")?.attempts).toBe(0);
  });

  test("a failure that cannot fix itself fails at once", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book
      .last("emma")
      .done.reject(Object.assign(new Error("Unauthorized"), { status: 401 }));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("failed");
    expect(manager.get("emma")?.failure).toMatchObject({
      reason: "auth",
      retryable: false,
    });
  });

  test("a job can name its own failure", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book
      .last("emma")
      .done.reject(
        new JobError({ reason: "storage", message: "Full", retryable: false }),
      );
    await clock.advance(0);
    expect(manager.get("emma")?.failure?.reason).toBe("storage");
  });

  test("the network coming back skips a retry's wait", async () => {
    const book = controllable();
    const { manager, network, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("retrying");
    network.set(false);
    network.set(true);
    expect(state(manager, "emma")).toBe("running");
  });
});

describe("cancel", () => {
  test("cancel stops the attempt, and its late result does not mark it done", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    const run = book.last("emma");
    manager.cancel("emma");
    expect(run.context.signal.aborted).toBe(true);
    run.done.resolve();
    await clock.advance(0);
    expect(state(manager, "emma")).toBe("cancelled");
  });

  test("a cancelled retry never fires", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book.last("emma").done.reject(new TypeError("Failed to fetch"));
    await clock.advance(0);
    manager.cancel("emma");
    await clock.advance(9_000);
    expect(book.runs).toHaveLength(1);
    expect(state(manager, "emma")).toBe("cancelled");
  });

  test("finished jobs leave the list after ten seconds", async () => {
    const book = controllable();
    const { manager, clock } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    book.last("emma").done.resolve();
    await clock.advance(9_999);
    expect(state(manager, "emma")).toBe("done");
    await clock.advance(1);
    expect(manager.get("emma")).toBeUndefined();
  });
});

describe("a reload", () => {
  test("brings back started work with its checkpoint, and failed work as failed", async () => {
    const book = controllable();
    const first = setup({ book: book.kind });
    first.manager.start("book", "emma", { id: "emma" });
    first.manager.start("book", "persuasion", { id: "persuasion" });
    first.manager.start("book", "sanditon", { id: "sanditon" });
    book.last("emma").context.progress({ done: 3, total: 10 });
    book.last("emma").context.checkpoint({ next: 3 });
    book
      .last("persuasion")
      .done.reject(Object.assign(new Error("Gone"), { status: 404 }));
    await first.clock.advance(0);
    book.last("sanditon").done.resolve();
    await first.clock.advance(1_000);
    first.manager.dispose();

    const second = createActivityManager({
      kinds: { book: book.kind },
      clock: first.clock,
      network: first.network,
      persist: { storage: first.storage, key: "jobs" },
      paused: true,
    });
    expect(second.get("emma")).toMatchObject({
      state: "queued",
      title: "Book emma",
      progress: { done: 3, total: 10 },
    });
    expect(state(second, "persuasion")).toBe("failed");
    expect(second.get("sanditon")).toBeUndefined();
    second.resume();
    expect(book.last("emma").context.resume).toEqual({ next: 3 });
  });

  test("a job is saved as soon as it starts", () => {
    const book = controllable();
    const { manager, storage, make } = setup({ book: book.kind });
    manager.start("book", "emma", { id: "emma" });
    // The page goes away before anything else happens.
    const next = make();
    expect(next.get("emma")?.state).not.toBeUndefined();
    expect(storage.values.size).toBe(1);
  });
});

describe("tracked jobs", () => {
  test("show what their owner says, and leave when it says nothing", () => {
    let view: { state: "running" | "waiting" } | null = null;
    const listeners = new Set<() => void>();
    const { manager } = setup({});
    manager.track("sync", {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      read: () => view && { kind: "sync", title: "Sync", state: view.state },
    });
    expect(manager.get("sync")).toBeUndefined();
    view = { state: "running" };
    listeners.forEach((listener) => listener());
    expect(manager.get("sync")).toMatchObject({
      state: "running",
      tracked: true,
    });
    view = null;
    listeners.forEach((listener) => listener());
    expect(manager.getSnapshot().jobs).toHaveLength(0);
  });
});

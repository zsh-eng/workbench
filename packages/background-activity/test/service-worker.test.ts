import { describe, expect, test } from "bun:test";
import { createActivityManager } from "../src/index";
import {
  createAppUpdate,
  precacheKey,
  type AppUpdateOptions,
  type ServiceWorkerLike,
} from "../src/service-worker";
import { FakeClock, FakeNetwork, MemoryStorage, settle } from "./helpers";

class FakeWorker implements ServiceWorkerLike {
  state = "installing";
  messages: unknown[] = [];
  private listeners = new Set<() => void>();
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "statechange", listener: () => void) {
    this.listeners.delete(listener);
  }
  become(state: string) {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeRegistration {
  scope = "https://reader.test/";
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  updates = 0;
  private listeners = new Set<() => void>();
  update = async () => {
    this.updates++;
  };
  addEventListener(_type: "updatefound", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "updatefound", listener: () => void) {
    this.listeners.delete(listener);
  }
  /** The browser found a new version and started to install it. */
  found() {
    this.installing = new FakeWorker();
    for (const listener of [...this.listeners]) listener();
    return this.installing;
  }
  /** It finished installing and now waits. */
  installed() {
    const worker = this.installing!;
    this.installing = null;
    this.waiting = worker;
    worker.become("installed");
  }
}

class FakeContainer {
  controller: unknown = {};
  private listeners = new Set<() => void>();
  addEventListener(_type: "controllerchange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "controllerchange", listener: () => void) {
    this.listeners.delete(listener);
  }
  /** The waiting worker took over this page. */
  change() {
    this.controller = {};
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeCaches {
  stored = new Set<string>();
  async open() {
    return { keys: async () => [...this.stored].map((url) => ({ url })) };
  }
}

const MANIFEST = [
  { url: "index.html", revision: "2", size: 2_000 },
  { url: "assets/app-new.js", revision: null, size: 600_000 },
  { url: "assets/old.css", revision: null, size: 40_000 },
];

async function setup(
  policy: "now" | "wait",
  overrides: Partial<AppUpdateOptions> = {},
) {
  const registration = new FakeRegistration();
  const container = new FakeContainer();
  const caches = new FakeCaches();
  const clock = new FakeClock();
  const storage = new MemoryStorage();
  let reloads = 0;
  const options: AppUpdateOptions = {
    container,
    register: async () => registration,
    policy: () => policy,
    readManifest: async () => MANIFEST,
    caches,
    reload: () => reloads++,
    clock,
    storage,
    checkIntervalMs: 60_000,
    ...overrides,
  };
  const update = createAppUpdate(options);
  await settle();
  return {
    update,
    registration,
    container,
    caches,
    clock,
    storage,
    options,
    reloads: () => reloads,
  };
}

describe("an update", () => {
  test("downloads in the background and reports the new files it stores", async () => {
    const { update, registration, caches, clock } = await setup("wait");
    // The old version's stylesheet is already stored.
    caches.stored.add(precacheKey(MANIFEST[2]!, registration.scope));
    registration.found();
    await clock.advance(0);
    expect(update.getSnapshot()).toMatchObject({
      status: "downloading",
      progress: { done: 0, total: 2, bytes: 0, totalBytes: 602_000 },
    });
    caches.stored.add(precacheKey(MANIFEST[1]!, registration.scope));
    await clock.advance(250);
    expect(update.getSnapshot().progress).toMatchObject({
      done: 1,
      bytes: 600_000,
    });
    registration.installed();
    expect(update.getSnapshot()).toMatchObject({
      status: "ready",
      progress: null,
    });
  });

  test("with the wait policy, it waits for apply, then switches and reloads", async () => {
    const { update, registration, container, reloads } = await setup("wait");
    registration.found();
    registration.installed();
    expect(update.getSnapshot().status).toBe("ready");
    expect(registration.waiting!.messages).toEqual([]);
    expect(reloads()).toBe(0);
    update.apply();
    expect(update.getSnapshot().status).toBe("applying");
    expect(registration.waiting!.messages).toEqual([{ type: "SKIP_WAITING" }]);
    container.change();
    expect(reloads()).toBe(1);
  });

  test("a switch that does not happen is ready again, and a later apply tries again", async () => {
    const { update, registration, container, clock, storage, reloads } =
      await setup("wait");
    registration.found();
    registration.installed();
    update.apply();
    await clock.advance(9_999);
    expect(update.getSnapshot().status).toBe("applying");
    await clock.advance(1);
    expect(update.getSnapshot().status).toBe("ready");
    expect(storage.values.size).toBe(0);
    update.apply();
    expect(registration.waiting!.messages).toHaveLength(2);
    container.change();
    expect(reloads()).toBe(1);
  });

  test("with the now policy, it switches as soon as it is ready, as an auto-updating PWA does", async () => {
    const { registration, container, reloads } = await setup("now");
    registration.found();
    registration.installed();
    expect(registration.waiting!.messages).toEqual([{ type: "SKIP_WAITING" }]);
    container.change();
    expect(reloads()).toBe(1);
  });

  test("a version that was already waiting at launch is ready at once", async () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    registration.waiting.state = "installed";
    const { update } = await setup("wait", {
      register: async () => registration,
    });
    expect(update.getSnapshot().status).toBe("ready");
  });

  test("another tab's switch does not reload this page under the wait policy", async () => {
    const { update, registration, container, reloads } = await setup("wait");
    registration.found();
    registration.installed();
    container.change();
    expect(reloads()).toBe(0);
    expect(update.getSnapshot()).toMatchObject({
      status: "ready",
      takenOver: true,
    });
    update.apply();
    expect(reloads()).toBe(1);
  });

  test("the page after the switch says it updated, once", async () => {
    const first = await setup("wait");
    first.registration.found();
    first.registration.installed();
    first.update.apply();
    first.container.change();
    const second = await setup("wait", { storage: first.storage });
    expect(second.update.getSnapshot().justUpdated).toBe(true);
    const third = await setup("wait", { storage: first.storage });
    expect(third.update.getSnapshot().justUpdated).toBe(false);
  });

  test("the first install is not an update", async () => {
    let offlineReady = 0;
    const container = new FakeContainer();
    container.controller = null;
    const { registration, update } = await setup("wait", {
      container,
      onOfflineReady: () => offlineReady++,
    });
    const worker = registration.found();
    worker.become("installed");
    worker.become("activated");
    expect(update.getSnapshot().status).toBe("idle");
    expect(offlineReady).toBe(1);
  });

  test("checks for a new version on its interval", async () => {
    const { registration, clock } = await setup("wait");
    await clock.advance(60_000);
    await clock.advance(60_000);
    expect(registration.updates).toBe(2);
  });

  test("shows in the activity list while it downloads and once it is ready", async () => {
    const { update, registration, clock } = await setup("wait");
    const manager = createActivityManager({
      kinds: {},
      clock,
      network: new FakeNetwork(),
    });
    manager.track("app-update", update.asJob());
    expect(manager.getSnapshot().jobs).toHaveLength(0);
    registration.found();
    await clock.advance(0);
    expect(manager.get("app-update")).toMatchObject({
      state: "running",
      origin: "app",
    });
    registration.installed();
    expect(manager.get("app-update")).toMatchObject({
      state: "waiting",
      waitingFor: "moment",
      origin: "user",
    });
  });
});

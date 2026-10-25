import type {
  ActivityClock,
  ActivityNetwork,
  ActivityStorage,
} from "../src/types";

/** Timers that run only when the test moves time. */
export class FakeClock implements ActivityClock {
  time = 1_000_000;
  private timers: { at: number; id: number; callback: () => void }[] = [];
  private nextId = 1;
  now = () => this.time;
  setTimeout = (callback: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.push({ at: this.time + Math.max(0, ms), id, callback });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  /** Move time on, running each timer that comes due, with promises settled between. */
  async advance(ms: number) {
    const until = this.time + ms;
    await settle();
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.timers[0];
      if (!next || next.at > until) break;
      this.timers.shift();
      this.time = next.at;
      next.callback();
      await settle();
    }
    this.time = until;
    await settle();
  }
}

/** Let pending promise callbacks run. */
export async function settle() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

export class FakeNetwork implements ActivityNetwork {
  online = true;
  private listeners = new Set<(online: boolean) => void>();
  isOnline = () => this.online;
  subscribe = (listener: (online: boolean) => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set(online: boolean) {
    this.online = online;
    for (const listener of [...this.listeners]) listener(online);
  }
}

export class MemoryStorage implements ActivityStorage {
  values = new Map<string, string>();
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.values.set(key, value);
  };
  removeItem = (key: string) => {
    this.values.delete(key);
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

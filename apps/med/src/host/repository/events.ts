/**
 * The revision of each checkout. A revision changes when a watcher sees a
 * change, and when a watcher starts or stops: a checkout without a watcher
 * can change unseen. All revisions come from one clock that starts at the
 * host's start time, so a page does not take a new host's revision for one
 * that it saw before.
 */
export class CheckoutRevisions {
  private clock = Date.now();
  private revisions = new Map<string, number>();
  // Checkouts whose watcher sees edits to their files, from the time it is ready.
  private live = new Set<string>();
  private listeners = new Set<(path: string) => void>();

  revision(path: string) {
    let value = this.revisions.get(path);
    if (value === undefined) {
      value = ++this.clock;
      this.revisions.set(path, value);
    }
    return value;
  }

  /** Records a change. Listeners hear of it at once, before the watcher's
   * delay, so a cached answer is never read after its change is seen. */
  changed(path: string) {
    this.revisions.set(path, ++this.clock);
    for (const listener of this.listeners) listener(path);
  }

  /** A watcher started (`false`), became ready to see file edits (`true`),
   * or stopped (`false`). */
  watching(path: string, live: boolean) {
    if (live) this.live.add(path);
    else this.live.delete(path);
    this.changed(path);
  }

  /**
   * A token that stays the same while nothing in the checkout changes,
   * including its files. Without a ready watcher that sees file edits there is
   * no token, and callers read again.
   */
  token(path: string) {
    return this.live.has(path) ? `${this.revision(path)}` : undefined;
  }

  subscribe(listener: (path: string) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

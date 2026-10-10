/** Retain entries by measured byte cost, evicting the least recently read first. */
export class ByteLru<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private total = 0;

  constructor(
    readonly maxBytes: number,
    readonly maxEntries = Infinity,
    /** Runs for every removed entry: eviction, replacement, deletion, and clear. */
    private readonly onEvict?: (key: string, value: T) => void,
  ) {}

  get bytes(): number {
    return this.total;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** An entry larger than the whole budget is not retained. */
  set(key: string, value: T, bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error("Cache size must be a non-negative number.");
    this.delete(key);
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.total += bytes;
    while (this.total > this.maxBytes || this.entries.size > this.maxEntries) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.delete(first);
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.total -= entry.bytes;
    this.entries.delete(key);
    this.onEvict?.(key, entry.value);
  }

  deleteWhere(predicate: (value: T, key: string) => boolean): void {
    for (const [key, entry] of this.entries) if (predicate(entry.value, key)) this.delete(key);
  }

  clear(): void {
    for (const key of [...this.entries.keys()]) this.delete(key);
  }
}

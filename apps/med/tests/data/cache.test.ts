import { describe, expect, test } from "vitest";
import { ByteLru } from "../../src/shared/byte-lru";

describe("byte-bounded cache", () => {
  test("evicts the least recently used entry and refuses an oversized entry", () => {
    const evicted: string[] = [];
    const cache = new ByteLru<string>(10, 3, (key) => evicted.push(key));
    cache.set("a", "first", 4);
    cache.set("b", "second", 4);
    expect(cache.get("a")).toBe("first");
    cache.set("c", "third", 4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("first");
    expect(cache.bytes).toBe(8);
    cache.set("large", "cannot retain", 11);
    expect(cache.get("large")).toBeUndefined();
    expect(cache.bytes).toBe(8);
    cache.set("a", "replacement", 2);
    expect(cache.bytes).toBe(6);
    cache.set("d", "fourth", 1);
    cache.set("e", "fifth", 1);
    expect(cache.get("c")).toBeUndefined();
    cache.deleteWhere((value) => value === "fifth");
    expect(cache.get("e")).toBeUndefined();
    expect(evicted).toEqual(["b", "a", "c", "e"]);
  });
});

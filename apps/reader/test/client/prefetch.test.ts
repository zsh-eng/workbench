import { describe, expect, it, vi } from "vitest";
import { preloadable } from "@/lib/prefetch";

describe("preloadable code", () => {
  it("loads once, however many callers start it", async () => {
    const load = vi.fn(async () => "code");
    const get = preloadable(load);

    expect(await Promise.all([get(), get()])).toEqual(["code", "code"]);
    expect(await get()).toBe("code");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("tries again after a load fails, as a route does after a failed prefetch", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("code");
    const get = preloadable(load);

    await expect(get()).rejects.toThrow("offline");
    await expect(get()).resolves.toBe("code");
    expect(load).toHaveBeenCalledTimes(2);
  });
});

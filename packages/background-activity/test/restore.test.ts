import { describe, expect, it } from "bun:test";
import { restoreIsland, type RestoreStage } from "../src/index";

const stage: RestoreStage = {
  progress: {
    mark: "progress",
    fraction: null,
    label: "Restoring library",
    detail: "12 books",
  },
  status: "Restoring your library…",
};
const sync = (
  connection: "online" | "offline" = "online",
  auth: "signed-in" | "expired" = "signed-in",
  failure: string | null = null,
) => ({
  connection,
  auth: { status: auth },
  failure: failure ? { kind: failure } : null,
});

describe("restoreIsland", () => {
  it("says the stage, then the app's confirmation once a restore it saw ends", () => {
    expect(restoreIsland(sync(), stage, true)).toEqual({
      content: stage.progress,
      status: "Restoring your library…",
    });
    expect(restoreIsland(sync(), null, true, "Library ready")).toEqual({
      content: { mark: "done", label: "Library ready" },
      status: "Library ready",
    });
    expect(restoreIsland(sync(), null, false).content).toBeNull();
  });

  it("says why it cannot go on, and keeps the stage for assistive technology", () => {
    expect(restoreIsland(sync("offline"), stage, true)).toEqual({
      content: { mark: "waiting", label: "Waiting for a connection" },
      status: "Restoring your library… Waiting for a connection.",
    });
    expect(
      restoreIsland(sync("online", "expired"), stage, true).content,
    ).toEqual({ mark: "attention", label: "Sign in to finish restoring" });
    expect(
      restoreIsland(
        sync("online", "signed-in", "upgrade-required"),
        stage,
        true,
      ).content,
    ).toEqual({ mark: "attention", label: "Update to finish restoring" });
  });

  it("does not confirm a restore that a stopped sync ended", () => {
    expect(
      restoreIsland(sync("online", "signed-in", "account-changed"), null, true)
        .content,
    ).toBeNull();
  });
});

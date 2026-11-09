import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createSettingsFile } from "../../src/host/settings-file";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

test("writes at the same time each keep the file whole, and keep each other's key", async () => {
  const folder = await mkdtemp(join(tmpdir(), "med-settings-"));
  folders.push(folder);
  const path = join(folder, "med", "settings.json");
  const file = createSettingsFile(path);
  // As toggling the layout twice and the theme once, quickly.
  await Promise.all([
    file.set("diffs.layout", "unified"),
    file.set("diffs.layout", "split"),
    file.set("theme.name", "pierre"),
  ]);
  const text = await readFile(path, "utf8");
  expect(JSON.parse(text)).toEqual({ "diffs.layout": "split", "theme.name": "pierre" });
  expect((await file.snapshot()).error).toBeNull();
});

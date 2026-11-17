import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runGrafanaCommand } from "../../src/cli/grafana";
import { startHost, type RunningHost } from "../../src/host/server";
import { FAKE_TOKEN, startFakeGrafana, type FakeGrafana } from "../fixtures/fake-grafana";

let folder: string;
let fake: FakeGrafana;
let host: RunningHost | undefined;
beforeEach(async () => {
  vi.stubEnv("MED_PORT", "");
  vi.stubEnv("MED_STATE_DIR", "");
  folder = await realpath(await mkdtemp(join(tmpdir(), "med-grafana-cli-")));
  fake = await startFakeGrafana({ base: "/grafana", anchor: Date.now() - 3_600_000 });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await host?.close();
  host = undefined;
  await fake.close();
  await rm(folder, { recursive: true, force: true });
});

test("med grafana connects a Grafana with a Keychain item, lists it, and removes it", async () => {
  const repo = join(folder, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await writeFile(join(repo, "notes.md"), "# Notes\n");
  const stateDir = join(folder, "state");
  host = await startHost({
    repo,
    stateDir,
    port: 0,
    keychain: async (item) => {
      if (item === "grafana-acme") return FAKE_TOKEN;
      throw new Error(`Your Keychain has no item named ${item}.`);
    },
  });
  const run = async (...args: string[]) => {
    const output: string[] = [];
    await runGrafanaCommand(
      [...args, "--state-dir", stateDir, "--port", String(host!.port)],
      (text) => output.push(text),
    );
    return output.join("\n");
  };

  expect(await run()).toContain("No Grafana yet");
  expect(await run("connect", fake.address, "--keychain", "grafana-acme")).toBe(
    `Connected to Acme · Grafana 11.3.0.\n${fake.address}  token in Keychain item grafana-acme`,
  );
  expect(await run("list")).toBe(`${fake.address}  token in Keychain item grafana-acme`);
  // The settings name the item; no file holds the token.
  const settings = JSON.parse(await readFile(join(stateDir, "settings.json"), "utf8"));
  expect(settings).toMatchObject({
    "grafana.sites": [fake.address],
    "grafana.keychain": { [fake.address]: "grafana-acme" },
  });
  expect(JSON.stringify(settings)).not.toContain(FAKE_TOKEN);
  await expect(run("connect", fake.address, "--keychain", "grafana-none")).rejects.toThrow(
    "no item named grafana-none",
  );
  await expect(run("connect", fake.address, "--keychain", "a", "--token-stdin")).rejects.toThrow(
    "Usage: med grafana",
  );
  expect(await run("remove", fake.address)).toContain(`Removed ${fake.address}.`);
  expect(JSON.parse(await run("--json")).sites).toEqual([]);
});

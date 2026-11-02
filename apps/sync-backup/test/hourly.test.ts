import { expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hourly } from "../src/schedule";

test("wb hourly runs sync, then arctic text --missing --unwall; a failing or hanging step doesn't stop the other, and the exit code tells", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-hourly-"));
  const calls = join(directory, "calls");
  const plan = join(directory, "plan.json");
  const browserPid = join(directory, "browser.pid");
  // A stand-in for wb: it notes its arguments, then exits with the code that
  // plan.json gives its command, or hangs with a "browser", and with
  // "ignore" ignores SIGTERM. The browser is in its own process group, as
  // Playwright starts Chromium, and ignores SIGTERM.
  const stub = join(directory, "wb.ts");
  writeFileSync(
    stub,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const step = JSON.parse(readFileSync(${JSON.stringify(plan)}, "utf8"))[args[0]];
if (step === "ignore") process.on("SIGTERM", () => {});
if (step === "hang" || step === "ignore") {
  const browser = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  writeFileSync(${JSON.stringify(browserPid)}, String(browser.pid));
  setInterval(() => {}, 1000);
} else process.exitCode = step;
`,
  );
  const run = async (
    steps: { sync: number | "hang" | "ignore"; arctic: number | "hang" },
    options?: { timeoutMs: number; graceMs?: number },
  ) => {
    writeFileSync(plan, JSON.stringify(steps));
    writeFileSync(calls, "");
    const code = await hourly(
      [process.execPath, stub],
      "https://sync.example.org",
      directory,
      options,
    );
    return {
      code,
      calls: readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[]),
    };
  };
  const flags = [
    "--origin",
    "https://sync.example.org",
    "--data-dir",
    directory,
    "--json",
  ];
  const commands = (result: { calls: string[][] }) =>
    result.calls.map((args) => args.slice(0, -flags.length).join(" "));
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // The browser is gone, once launchd reaps it.
  const browserGone = async () => {
    const browser = Number(readFileSync(browserPid, "utf8"));
    for (let tries = 0; tries < 40 && alive(browser); tries++)
      await Bun.sleep(50);
    return !alive(browser);
  };
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await run({ sync: 0, arctic: 0 })).toEqual({
      code: 0,
      calls: [
        ["sync", ...flags],
        ["arctic", "text", "--missing", "--unwall", ...flags],
      ],
    });
    // A failed step doesn't stop the next; the job exits with its code.
    for (const [steps, code] of [
      [{ sync: 3, arctic: 0 }, 3],
      [{ sync: 0, arctic: 4 }, 4],
    ] as const) {
      const result = await run(steps);
      expect(result.code).toBe(code);
      expect(commands(result)).toEqual(["sync", "arctic text --missing --unwall"]);
    }
    expect(errors).not.toHaveBeenCalled();
    // A step that hangs gets SIGTERM at the cap, the next step runs, and
    // the job fails with 128 + SIGTERM's number and says why. The browser
    // it left is killed.
    let started = performance.now();
    const hung = await run({ sync: "hang", arctic: 0 }, { timeoutMs: 2000 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(2000);
    expect(hung.code).toBe(143);
    expect(commands(hung)).toEqual(["sync", "arctic text --missing --unwall"]);
    expect(errors.mock.calls).toEqual([
      ["wb hourly: wb sync ran over 2 s; stopping it"],
    ]);
    expect(await browserGone()).toBe(true);
    // A step that ignores SIGTERM, and its browser, get SIGKILL after the
    // grace period.
    errors.mockClear();
    started = performance.now();
    const ignored = await run(
      { sync: "ignore", arctic: 0 },
      { timeoutMs: 2000, graceMs: 500 },
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(2500);
    expect(ignored.code).toBe(137);
    expect(commands(ignored)).toEqual([
      "sync",
      "arctic text --missing --unwall",
    ]);
    expect(errors.mock.calls).toEqual([
      ["wb hourly: wb sync ran over 2 s; stopping it"],
      [
        "wb hourly: wb sync didn't stop in 0.5 s; killing it and what it started",
      ],
    ]);
    expect(await browserGone()).toBe(true);
  } finally {
    errors.mockRestore();
    if (existsSync(browserPid))
      try {
        process.kill(Number(readFileSync(browserPid, "utf8")), "SIGKILL");
      } catch {
        /* Gone, as it should be. */
      }
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

test("wb hourly runs the real steps with its origin, data directory and credential", async () => {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      requests.push(
        `${request.method} ${new URL(request.url).pathname} ${request.headers.get("Authorization")}`,
      );
      return new Response("", { status: 404 });
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "wb-hourly-cli-"));
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dirname, "../src/cli.ts"),
      "hourly",
      "--origin",
      server.url.origin,
      "--data-dir",
      directory,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WORKBENCH_TOKEN: "fixture" },
    },
  );
  try {
    // Both steps reach this origin with the credential; it answers neither.
    expect(await child.exited).toBe(1);
    expect(requests).toContain("GET /api/me Bearer fixture");
    expect(requests).toContain(
      "GET /api/apps/arctic/sync/v3/state Bearer fixture",
    );
    expect(existsSync(join(directory, "mirror.sqlite"))).toBe(true);
  } finally {
    child.kill();
    server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

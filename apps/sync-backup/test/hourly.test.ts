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

test("wb hourly runs sync, then arctic text --missing --unwall; a failing or hanging step doesn't stop the other, and the exit code tells", () => {
  const directory = mkdtempSync(join(tmpdir(), "wb-hourly-"));
  const calls = join(directory, "calls");
  const plan = join(directory, "plan.json");
  // A stand-in for wb: it notes its arguments, then exits with the code that
  // plan.json gives its command, or hangs.
  const stub = join(directory, "wb.ts");
  writeFileSync(
    stub,
    `import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n");
const step = JSON.parse(readFileSync(${JSON.stringify(plan)}, "utf8"))[args[0]];
if (step === "hang") setInterval(() => {}, 1000);
else process.exitCode = step;
`,
  );
  const run = (
    steps: { sync: number | "hang"; arctic: number | "hang" },
    timeoutMs = 30_000,
  ) => {
    writeFileSync(plan, JSON.stringify(steps));
    writeFileSync(calls, "");
    const code = hourly(
      [process.execPath, stub],
      "https://sync.example.org",
      directory,
      timeoutMs,
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
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(run({ sync: 0, arctic: 0 })).toEqual({
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
      const result = run(steps);
      expect(result.code).toBe(code);
      expect(commands(result)).toEqual(["sync", "arctic text --missing --unwall"]);
    }
    expect(errors).not.toHaveBeenCalled();
    // A step that hangs is stopped at the cap, the next step runs, and the
    // job fails and says why.
    const started = performance.now();
    const result = run({ sync: "hang", arctic: 0 }, 2000);
    expect(performance.now() - started).toBeGreaterThanOrEqual(2000);
    expect(result.code).toBe(1);
    expect(commands(result)).toEqual(["sync", "arctic text --missing --unwall"]);
    expect(errors.mock.calls).toEqual([
      ["wb hourly: wb sync ran over 2 s and was stopped"],
    ]);
  } finally {
    errors.mockRestore();
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

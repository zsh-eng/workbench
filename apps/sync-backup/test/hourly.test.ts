import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const run = (steps: { sync: number | "hang"; arctic: number | "hang" }) => {
    writeFileSync(plan, JSON.stringify(steps));
    writeFileSync(calls, "");
    const code = hourly(
      [process.execPath, stub],
      "https://sync.example.org",
      directory,
      1000,
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
    // A step that hangs is stopped at the cap, the next step runs, and the
    // job fails.
    for (const steps of [
      { sync: "hang", arctic: 0 },
      { sync: 0, arctic: "hang" },
    ] as const) {
      const started = performance.now();
      const result = run(steps);
      expect(performance.now() - started).toBeLessThan(4000);
      expect(result.code).not.toBe(0);
      expect(commands(result)).toEqual(["sync", "arctic text --missing --unwall"]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

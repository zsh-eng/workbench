import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runDashboardCommand } from "../../src/cli/dashboard";
import { startHost, type RunningHost } from "../../src/host/server";

let folder: string;
let host: RunningHost | undefined;
beforeEach(async () => {
  vi.stubEnv("MED_PORT", "");
  vi.stubEnv("MED_STATE_DIR", "");
  folder = await realpath(await mkdtemp(join(tmpdir(), "med-dashboard-cli-")));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  await host?.close();
  host = undefined;
  await rm(folder, { recursive: true, force: true });
});

// A source that takes a moment, as one that fetches would, and fails for a
// metric it does not know.
const SOURCE = `#!/bin/sh
sleep 0.2
case "$MED_CHART_METRIC" in
  requests) printf 'time,req/s\\n1763290800,400\\n1763290860,500\\n' ;;
  *) echo "no metric named $MED_CHART_METRIC" >&2; exit 3 ;;
esac
`;

async function start() {
  const repo = join(folder, "repo");
  const stateDir = join(folder, "state");
  await mkdir(repo);
  await mkdir(join(stateDir, "dashboards"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const source = join(folder, "status-chart");
  await writeFile(source, SOURCE);
  await chmod(source, 0o755);
  await writeFile(
    join(stateDir, "settings.json"),
    JSON.stringify({ "charts.sources": { "https://status.acme.build": source } }),
  );
  host = await startHost({ repo, stateDir, port: 0 });
  return { stateDir };
}

test("a page of many charts reads them all: chart reads wait their turn, and none is turned away", async () => {
  await start();
  const reads = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      fetch(new URL("/api/charts/link", host!.url), {
        method: "POST",
        headers: { authorization: `Bearer ${host!.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          link: `https://status.acme.build/checkout?panel=${index}`,
          meta: { metric: "requests" },
        }),
      }).then(async (response) => ({ status: response.status, body: await response.json() })),
    ),
  );
  expect(reads.map((read) => read.status)).toEqual(Array(12).fill(200));
  expect(reads[11]!.body.rows).toContain("1763290860,500");
});

test("med dashboard lists the dashboards and checks one, panel by panel, exiting 1 when one fails", async () => {
  const { stateDir } = await start();
  await writeFile(
    join(stateDir, "dashboards", "checkout.dashboard.yaml"),
    `title: Checkout
inputs:
  env: [prod, staging]
panels:
  - link: https://status.acme.build/checkout?env=\${env}
    metric: requests
    type: stat
    title: Requests
  - link: https://status.acme.build/checkout?env=\${env}
    metric: latency
    title: Latency
  - text: "**Owner**: payments"
`,
  );
  const run = async (...args: string[]) => {
    const output: string[] = [];
    await runDashboardCommand(
      [...args, "--state-dir", stateDir, "--port", String(host!.port)],
      (text) => output.push(text),
    );
    return output.join("\n");
  };
  expect(await run()).toMatch(/^personal\/checkout {2}Checkout {2}3 panels\n {2}\//);
  const check = await run("check", "personal/checkout", "--set", "env=staging");
  expect(check).toContain("Inputs: env=staging");
  expect(check).toContain("✓ 1. Requests (stat, line 5) from https://status.acme.build");
  expect(check).toContain("500 (req/s), +25.0% over the range");
  expect(check).toContain("✗ 2. Latency (chart, line 9) from https://status.acme.build");
  expect(check).toContain("no metric named latency");
  expect(check).toContain("· 3. Owner: payments (text, line 12)");
  expect(check).toContain("2 charts: 1 drew, 1 failed.");
  expect(check).toMatch(
    /\[Open the dashboard in Med\]\(http:\/\/.+\/dashboards\/personal\/checkout\)$/,
  );
  expect(process.exitCode).toBe(1);
});

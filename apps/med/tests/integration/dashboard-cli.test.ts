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
  env: { options: environments.csv }
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
  // The environments are a list that a script keeps, beside the dashboard.
  await writeFile(join(stateDir, "dashboards", "environments.csv"), "name\nprod\nstaging\n");
  expect(await run()).toMatch(/^personal\/checkout {2}Checkout {2}3 panels\n {2}\//);
  const check = await run("check", "personal/checkout", "--set", "env=staging");
  expect(check).toContain("Inputs: env=staging");
  expect(check).toContain("Options of env, from environments.csv: prod, staging (2)");
  expect(check).toContain("✓ 1. Requests (stat, line 5) from https://status.acme.build");
  expect(check).toContain("500 (req/s), +25.0% over the range");
  expect(check).toContain("✗ 2. Latency (chart, line 9) from https://status.acme.build");
  expect(check).toContain("no metric named latency");
  expect(check).toContain("· 3. Owner: payments (text, line 12)");
  expect(check).toContain("2 charts: 1 drew, 1 failed.");
  expect(check).toMatch(
    /\[Open the dashboard in Med\]\(http:\/\/.+\/dashboards\/personal\/checkout\?var-env=staging\)$/,
  );
  expect(process.exitCode).toBe(1);
});

test("med dashboard open changes only what it names on the reader's screen, and opens the browser when no window listens", async () => {
  const { stateDir } = await start();
  await writeFile(
    join(stateDir, "dashboards", "checkout.dashboard.yaml"),
    `title: Checkout
range: now-6h
inputs:
  env: [prod, staging]
  service: checkout
panels:
  - link: https://status.acme.build/\${service}?env=\${env}&from=\${from}&to=\${to}
    metric: requests
    type: stat
    title: Requests
`,
  );
  const opened: string[] = [];
  const run = async (...args: string[]) => {
    const output: string[] = [];
    await runDashboardCommand(
      [...args, "--state-dir", stateDir, "--port", String(host!.port)],
      (text) => output.push(text),
      (url) => opened.push(url),
    );
    return output.join("\n");
  };
  const auth = { authorization: `Bearer ${host!.token}` };

  // No window listens: the dashboard opens in the browser, with its values.
  expect(await run("open", "personal/checkout", "--set", "env=staging")).toContain(
    "No Med window was open, so Checkout opened in the browser: env=staging.",
  );
  expect(opened[0]).toMatch(/\/dashboards\/personal\/checkout\?var-env=staging#token=/);

  // A window listens, and says what it shows.
  const abort = new AbortController();
  const stream = await fetch(new URL("/api/windows", host!.url), {
    headers: auth,
    signal: abort.signal,
  });
  const reader = stream.body!.getReader();
  const shows: string[] = [];
  const reading = (async () => {
    let text = "";
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      text += new TextDecoder().decode(value);
      for (const match of text.matchAll(/event: show\ndata: (.+)\n/g))
        if (!shows.includes(match[1]!)) shows.push(match[1]!);
    }
  })();
  await fetch(new URL("/api/dashboards/report", host!.url), {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      id: "personal/checkout",
      values: { env: "staging", service: "checkout", from: "now-6h", to: "now" },
      showing: true,
    }),
  });
  expect(await run()).toMatch(
    /^On screen: personal\/checkout {2}env=staging {2}service=checkout {2}Last 6 hours\n/,
  );

  // Without a dashboard named, open takes the one on screen and keeps its other values.
  const said = await run("open", "--range", "yesterday 14:00 to 16:30");
  expect(said).toMatch(
    /^Med shows Checkout: env=staging {2}service=checkout {2}\w{3} \d+, 14:00 – 16:30\./,
  );
  await expect.poll(() => shows.length).toBe(1);
  const path = JSON.parse(shows[0]!).path as string;
  expect(path).toMatch(
    /^\/dashboards\/personal\/checkout\?var-env=staging&var-service=checkout&from=\d{13}&to=\d{13}$/,
  );
  // The host knows the new values before the window says them again.
  expect(await run("check")).toContain("Inputs: env=staging  service=checkout  ");

  // Only the dashboard's own inputs and values.
  await expect(run("open", "--set", "region=eu")).rejects.toThrow(
    "Checkout has no input region. Its inputs: env (prod, staging), service.",
  );
  await expect(run("open", "--set", "env=dev")).rejects.toThrow(
    'env takes one of prod, staging, not "dev".',
  );
  await expect(run("open", "--range", "whenever")).rejects.toThrow(
    'Med does not read "whenever" as a range.',
  );
  abort.abort();
  await reading;
});

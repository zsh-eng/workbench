import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { runDashboardCommand } from "../../src/cli/dashboard";
import { runReviewCommand } from "../../src/cli/review";
import { startHost, type RunningHost } from "../../src/host/server";

let folder: string;
let host: RunningHost | undefined;
beforeEach(async () => {
  vi.stubEnv("MED_PORT", "");
  vi.stubEnv("MED_STATE_DIR", "");
  vi.stubEnv("MED_THREAD_KEY", "");
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
  return { stateDir, repo };
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

test("med dashboard history lists the values every window kept, newest first, across a restart; an agent in a thread names its thread when it shows one", async () => {
  const { stateDir, repo } = await start();
  await writeFile(
    join(stateDir, "dashboards", "checkout.dashboard.yaml"),
    `title: Checkout
range: now-6h
inputs:
  env: [prod, staging]
views:
  - name: Overview
    panels: [{ text: "\${env}" }]
  - name: Errors
    panels: [{ text: "errors in \${env}" }]
`,
  );
  const output: string[] = [];
  const run = async (...args: string[]) => {
    output.length = 0;
    await runDashboardCommand(
      [...args, "--state-dir", stateDir, "--port", String(host!.port)],
      (text) => output.push(text),
      () => {},
    );
    return output.join("\n");
  };
  const auth = { authorization: `Bearer ${host!.token}`, "content-type": "application/json" };
  const keep = async (values: Record<string, string>, by?: "agent") => {
    const response = await fetch(new URL("/api/dashboards/history/keep", host!.url), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ id: "personal/checkout", values, ...(by ? { by } : {}) }),
    });
    return (
      (await response.json()) as { entries: { values: Record<string, string>; by?: string }[] }
    ).entries;
  };
  const prod = { env: "prod", from: "now-6h", to: "now" };
  const staging = { env: "staging", from: "now-24h", to: "now" };

  expect(await run("history", "personal/checkout")).toBe("Checkout has not shown in Med yet.");
  await keep(prod);
  await keep(staging, "agent");
  // The same values again, in another view, change nothing; values seen
  // before move to the top.
  expect((await keep({ ...staging, view: "Errors" })).map((entry) => entry.values.env)).toEqual([
    "staging",
    "prod",
  ]);
  expect((await keep(prod)).map((entry) => entry.values)).toEqual([prod, staging]);
  // Values that an agent chose stay its choice when the reader shows them again.
  expect((await keep(staging)).map((entry) => entry.by)).toEqual(["agent", undefined]);
  await keep(prod);

  // Med keeps them across a restart.
  await host!.close();
  host = await startHost({ repo, stateDir, port: 0 });
  const listed = (await run("history", "personal/checkout")).split("\n");
  expect(listed[0]).toBe("Checkout  personal/checkout");
  expect(listed[1]).toMatch(/^ {2}now {9}env=prod {2}Last 6 hours$/);
  expect(listed[2]).toMatch(/^ {2}now {9}env=staging {2}Last 24 hours {2}\(an agent's\)$/);
  expect(JSON.parse(await run("history", "personal/checkout", "--json")).entries).toHaveLength(2);

  // An agent in a Med thread (MED_THREAD_KEY) shows the dashboard with its
  // thread, so a window that shows that thread shows it beside the thread.
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.invalid", ...args], {
      cwd: repo,
    });
  await writeFile(join(repo, "notes.md"), "before\n");
  git("add", ".");
  git("commit", "-q", "-m", "before");
  await writeFile(join(repo, "notes.md"), "after\n");
  await runReviewCommand(
    [
      ...["create", "--title", "Checkout notes", "--key", "ops", "--repo", repo, "--working"],
      ...["--no-pr", "--state-dir", stateDir, "--port", String(host!.port)],
    ],
    { print: () => {}, openUrl: () => {}, environment: {}, home: folder },
  );
  const thread = (
    (await (
      await fetch(new URL("/api/threads/by-key", host!.url), {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ key: "ops" }),
      })
    ).json()) as { thread: string }
  ).thread;
  const abort = new AbortController();
  const stream = await fetch(new URL("/api/windows", host!.url), {
    headers: auth,
    signal: abort.signal,
  });
  const reader = stream.body!.getReader();
  let heard = "";
  const reading = (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      heard += new TextDecoder().decode(value);
    }
  })();
  vi.stubEnv("MED_THREAD_KEY", "ops");
  await run("open", "personal/checkout", "--set", "env=staging");
  vi.stubEnv("MED_THREAD_KEY", "");
  await run("open", "personal/checkout", "--set", "env=prod");
  await expect.poll(() => [...heard.matchAll(/event: show\ndata: (.+)\n/g)].length).toBe(2);
  const shows = [...heard.matchAll(/event: show\ndata: (.+)\n/g)].map((match) =>
    JSON.parse(match[1]!),
  );
  expect(shows).toEqual([
    { type: "show", path: "/dashboards/personal/checkout?var-env=staging", thread },
    { type: "show", path: "/dashboards/personal/checkout?var-env=prod" },
  ]);
  abort.abort();
  await reading;
});

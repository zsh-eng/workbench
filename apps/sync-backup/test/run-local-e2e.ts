/** Disposable real Worker + browser fixture. Requires only installed workspace dev tools. */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "wb-local-e2e-"));
const service = resolve(import.meta.dirname, "../../sync-server");
const probe = createServer();
await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((r) => probe.close(() => r()));
const origin = `http://localhost:${port}`;
const config = join(directory, "wrangler.json");
writeFileSync(
  config,
  JSON.stringify({
    name: "workbench-cli-test",
    main: join(service, "src/index.ts"),
    compatibility_date: "2026-04-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    d1_databases: [
      {
        binding: "DATABASE",
        database_name: "workbench-cli-test",
        database_id: "00000000-0000-0000-0000-000000000094",
        migrations_dir: join(service, "migrations"),
      },
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: "workbench-cli-test" }],
    vars: {
      BASE_URL: origin,
      APP_ORIGINS: origin,
      BETTER_AUTH_SECRET: "disposable-cli-local-test-secret-2026",
      LOCAL_DEVELOPMENT: "true",
    },
  }),
  { mode: 0o600 },
);
const wrangler = join(service, "node_modules/.bin/wrangler");
let server: ReturnType<typeof spawn> | undefined;
let logs = "";
try {
  const migrate = Bun.spawn(
    [
      wrangler,
      "d1",
      "migrations",
      "apply",
      "workbench-cli-test",
      "--config",
      config,
      "--local",
      "--persist-to",
      directory,
    ],
    { cwd: service, stdout: "pipe", stderr: "pipe" },
  );
  const migrationOutput = await new Response(migrate.stdout).text();
  if (await migrate.exited)
    throw Error(migrationOutput + (await new Response(migrate.stderr).text()));
  server = spawn(
    wrangler,
    [
      "dev",
      "--config",
      config,
      "--local",
      "--persist-to",
      directory,
      "--port",
      String(port),
    ],
    { cwd: service, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout?.on("data", (data) => {
    logs = (logs + data).slice(-8000);
  });
  server.stderr?.on("data", (data) => {
    logs = (logs + data).slice(-8000);
  });
  const deadline = Date.now() + 60000;
  while (true) {
    if (server.exitCode !== null || Date.now() > deadline)
      throw Error("Local Worker failed: " + logs);
    try {
      if (
        (await fetch(origin + "/health", { signal: AbortSignal.timeout(1000) }))
          .ok
      )
        break;
    } catch {}
    await Bun.sleep(500);
  }
  const fixture = Bun.spawn(
    ["bun", join(import.meta.dirname, "local-e2e.ts")],
    {
      env: { ...process.env, WB_TEST_ORIGIN: origin },
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (await fixture.exited) throw Error("Local CLI end-to-end test failed");
} finally {
  if (server?.pid && server.exitCode === null) {
    const exited = new Promise<void>((r) => server!.once("exit", () => r()));
    process.kill(-server.pid, "SIGTERM");
    await exited;
  }
  rmSync(directory, { recursive: true, force: true });
}

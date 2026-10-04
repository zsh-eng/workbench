/** Local-only stack. Ctrl-C stops every child started by this command. */
const root = new URL("../", import.meta.url).pathname;
const config = process.env.SHARED_WORKER_CONFIG;
const persist = process.env.SHARED_PERSIST_TO;
const workerOptions = [
  ...(config ? ["--config", config] : []),
  ...(persist ? ["--persist-to", persist] : []),
];
for (const command of [
  ["bun", "run", "build:packages"],
  [
    "bun",
    "x",
    "--no-install",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "workbench-sync-local",
    "--local",
    ...workerOptions,
  ],
]) {
  const code = await Bun.spawn(command, {
    cwd: command[1] === "x" ? `${root}apps/sync-server` : root,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (code) process.exit(code);
}
const children = [
  Bun.spawn(
    [
      "bun",
      "x",
      "--no-install",
      "wrangler",
      "dev",
      "--local",
      "--port",
      "8792",
      ...workerOptions,
    ],
    {
      cwd: `${root}apps/sync-server`,
      stdout: "inherit",
      stderr: "inherit",
    },
  ),
  ...[
    ["reader", "5175"],
    ["spaced2", "5180"],
  ].map(([app, port]) =>
    Bun.spawn(
      [
        "bun",
        "x",
        "--no-install",
        "vite",
        "--host",
        "localhost",
        "--port",
        port,
        "--strictPort",
      ],
      {
        cwd: `${root}apps/${app}`,
        env: { ...process.env, VITE_SHARED_API_URL: "http://localhost:8792" },
        stdout: "inherit",
        stderr: "inherit",
      },
    ),
  ),
];
function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const result = await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));
process.exit(result);

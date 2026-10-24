/** Local-only stack. Ctrl-C stops every child started by this command. */
const root = new URL("../", import.meta.url).pathname;
const config = process.env.SHARED_WORKER_CONFIG;
const persist = process.env.SHARED_PERSIST_TO;
const workerOptions = [
  ...(config ? ["--config", config] : []),
  ...(persist ? ["--persist-to", persist] : []),
];
// SHARED_API_PORT and SHARED_APP_PORT (with one app) move the stack off the
// usual ports, so test suites in two worktrees can run at once.
const apiPort = process.env.SHARED_API_PORT ?? "8792";
const apps = [
  ["reader", "5175"],
  ["spaced2", "5180"],
  ["arctic/Browser", "5186"],
]
  .filter(
    ([app]) =>
      !process.env.SHARED_APPS ||
      process.env.SHARED_APPS.split(",").includes(app!),
  )
  .map(([app, port]) => [app!, process.env.SHARED_APP_PORT ?? port!]);
const moved =
  !!process.env.SHARED_API_PORT || !!process.env.SHARED_APP_PORT
    ? [
        "--var",
        `BASE_URL:http://localhost:${apiPort}`,
        "--var",
        `APP_ORIGINS:${apps.map(([, port]) => `http://localhost:${port}`).join(",")}`,
        ...(process.env.SHARED_INSPECTOR_PORT
          ? ["--inspector-port", process.env.SHARED_INSPECTOR_PORT]
          : []),
      ]
    : [];
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
      apiPort,
      ...workerOptions,
      ...moved,
    ],
    {
      cwd: `${root}apps/sync-server`,
      stdout: "inherit",
      stderr: "inherit",
    },
  ),
  // SHARED_APPS=arctic/Browser starts one app; the default starts all three.
  ...apps.map(([app, port]) =>
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
        env: {
          ...process.env,
          VITE_SHARED_API_URL: `http://localhost:${apiPort}`,
        },
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

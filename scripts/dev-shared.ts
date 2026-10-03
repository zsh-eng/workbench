/** Local-only stack. Ctrl-C stops every child started by this command. */
const root = new URL("../", import.meta.url).pathname;
for (const command of [
  ["bun", "run", "build:packages"],
  ["bun", "run", "db:sync:local"],
]) {
  const code = await Bun.spawn(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (code) process.exit(code);
}
const children = [
  Bun.spawn(["bun", "run", "dev"], {
    cwd: `${root}apps/sync-server`,
    stdout: "inherit",
    stderr: "inherit",
  }),
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

// Keeps the Med login service on Workbench's latest main commit (macOS).
//
//   bun scripts/track-main.ts install     build main, install the service and a watcher
//   bun scripts/track-main.ts update      rebuild when main has moved; the watcher runs this
//   bun scripts/track-main.ts uninstall   remove the watcher, the service, and the build
//
// Builds use a separate detached worktree, so uncommitted work in the shared
// checkout never reaches the service. A failed build keeps the previous
// executable running and shows a notification.
import { execFile } from "node:child_process";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { getStateDirectory } from "../src/host/runtime/connection";
import { serviceLabel } from "../src/cli/login-service";

const exec = promisify(execFile);
const home = join(homedir(), ".local", "share", "med");
const source = join(home, "build");
const binary = join(home, "bin", "med");
const installed = `${binary}.commit`;
const failed = `${binary}.failed`;
const log = join(home, "update.log");
const watcher = "local.med.track-main";
const domain = `gui/${process.getuid!()}`;
const agents = join(homedir(), "Library", "LaunchAgents");

async function run(command: string, args: string[], cwd: string) {
  try {
    const { stdout } = await exec(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-40).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed${tail ? `:\n${tail}` : "."}`);
  }
}
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
const text = (path: string) =>
  readFile(path, "utf8").then(
    (value) => value.trim(),
    () => "",
  );
async function note(message: string) {
  console.log(message);
  await mkdir(home, { recursive: true });
  await appendFile(log, `${new Date().toISOString()} ${message}\n`);
}
const loaded = (label: string) =>
  run("launchctl", ["print", `${domain}/${label}`], home).then(
    () => true,
    () => false,
  );
const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The script runs from the shared checkout or from the build worktree; both
// share one Git directory.
const repo = dirname(
  await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], import.meta.dir),
);

async function build(head: string) {
  if (await exists(join(source, ".git")))
    await run("git", ["checkout", "--quiet", "--detach", "--force", head], source);
  else await run("git", ["worktree", "add", "--quiet", "--detach", source, head], repo);
  await run("bun", ["install", "--frozen-lockfile"], source);
  const app = join(source, "apps", "med");
  await run("bun", ["run", "build:executable"], app);
  const built = join(app, "dist", "med");
  // Bun appends the bundle after linking. Sign again so macOS runs it.
  await run("codesign", ["--force", "--sign", "-", built], app);
  await run(built, ["--version"], app);
  await mkdir(dirname(binary), { recursive: true });
  await copyFile(built, `${binary}.next`);
  // A rename keeps the running server's executable intact until it restarts.
  await rename(`${binary}.next`, binary);
}

async function update() {
  // Main can move again during a build; finish only on the latest commit.
  for (;;) {
    const head = await run("git", ["rev-parse", "--verify", "main^{commit}"], repo);
    if (head === (await text(installed)) && (await exists(binary))) return;
    // Wait for the next commit instead of retrying a broken one on each ref change.
    if (head === (await text(failed))) return;
    const started = Date.now();
    try {
      await build(head);
    } catch (error) {
      await writeFile(failed, `${head}\n`);
      await note(`${head.slice(0, 8)} failed. The previous build keeps running.\n${error}`);
      await run(
        "osascript",
        [
          "-e",
          `display notification "Build ${head.slice(0, 8)} failed. See ${log}." with title "Med update"`,
        ],
        home,
      ).catch(() => {});
      return;
    }
    await writeFile(installed, `${head}\n`);
    await rm(failed, { force: true });
    const label = serviceLabel(getStateDirectory());
    const restart = await loaded(label);
    if (restart) await run("launchctl", ["kickstart", "-k", `${domain}/${label}`], home);
    const seconds = Math.round((Date.now() - started) / 1000);
    await note(
      `${head.slice(0, 8)} installed in ${seconds}s${restart ? "; service restarted" : ""}.`,
    );
  }
}

async function stopServer() {
  await run(binary, ["service", "uninstall"], home).catch(() => {});
  await run(binary, ["stop"], home).catch(() => {});
  for (let attempt = 0; attempt < 50; attempt++) {
    const status = JSON.parse(await run(binary, ["status"], home).catch(() => "{}"));
    if (status.running === false) return;
    await Bun.sleep(200);
  }
  throw new Error("The running Med server did not stop. Run med stop, then try again.");
}

async function install() {
  if (process.platform !== "darwin") throw new Error("This script installs macOS LaunchAgents.");
  await rm(failed, { force: true });
  await update();
  if (!(await exists(binary))) throw new Error(`The build failed. See ${log}.`);
  // The login service replaces a server started by hand.
  await stopServer();
  await run(binary, ["service", "install"], home);
  const script = join(source, "apps", "med", "scripts", "track-main.ts");
  const plist = join(agents, `${watcher}.plist`);
  // Ref updates in refs/heads start an update. The interval and login start
  // catch a change that arrives while an update runs.
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${watcher}</string>
  <key>ProgramArguments</key><array>
    <string>${escape(process.execPath)}</string><string>${escape(script)}</string><string>update</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(process.env.PATH ?? "")}</string></dict>
  <key>WatchPaths</key><array><string>${escape(join(repo, ".git", "refs", "heads"))}</string></array>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>${escape(log)}</string>
</dict></plist>
`,
    { mode: 0o600 },
  );
  await run("launchctl", ["bootout", `${domain}/${watcher}`], home).catch(() => {});
  await run("launchctl", ["bootstrap", domain, plist], home);
  console.log(`Med follows main at ${repo}.
Executable: ${binary}
Log: ${log}
To use med in a terminal, add this line to ~/.zshrc:
  export PATH="$HOME/.local/share/med/bin:$PATH"`);
}

async function uninstall() {
  await run("launchctl", ["bootout", `${domain}/${watcher}`], home).catch(() => {});
  await rm(join(agents, `${watcher}.plist`), { force: true });
  if (await exists(binary)) await run(binary, ["service", "uninstall"], home).catch(() => {});
  if (await exists(source))
    await run("git", ["worktree", "remove", "--force", source], repo).catch(() => {});
  await rm(home, { recursive: true, force: true });
  console.log("Removed the watcher, the login service, and the build. Sources and reviews remain.");
}

const command = process.argv[2];
if (command === "install") await install();
else if (command === "update") await update();
else if (command === "uninstall") await uninstall();
else {
  console.error("Usage: bun scripts/track-main.ts install|update|uninstall");
  process.exit(1);
}

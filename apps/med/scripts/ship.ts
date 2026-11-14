// From a tested commit to a published release, with this Mac running it, in
// one command:
//
//   bun scripts/ship.ts patch|minor|major|<version> --notes <file>
//   bun scripts/ship.ts --dry-run   (builds the archive; no commit, no publish)
//
// Tests and validations run before a change is called done (docs/TESTING.md),
// so this repeats none of them. The web bundle does not name the version: a web
// build newer than every source it reads is reused, and only the server, which
// does, builds again. This Mac's Med installs while GitHub takes the upload.
import { execFile, execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const started = performance.now();
const say = (text: string) =>
  console.log(`${((performance.now() - started) / 1000).toFixed(1)}s  ${text}`);
const run = (command: string, args: string[], cwd = app) =>
  execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
const runAsync = (command: string, args: string[], cwd = app) =>
  new Promise<string>((done, failed) =>
    execFile(
      command,
      args,
      { cwd, encoding: "utf8", maxBuffer: 1 << 26 },
      (error, stdout, stderr) =>
        error
          ? failed(new Error(`${command} ${args.join(" ")}: ${stderr || error.message}`))
          : done(stdout.trim()),
    ),
  );
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const notesIndex = args.indexOf("--notes");
const bump = args.find(
  (arg, index) => !arg.startsWith("--") && (notesIndex < 0 || index !== notesIndex + 1),
);
const notesAt = notesIndex >= 0 ? resolve(args[notesIndex + 1]!) : undefined;
if (!dry && (!bump || !notesAt))
  throw new Error("Usage: bun scripts/ship.ts patch|minor|major|<version> --notes <file>");
if (notesAt && !(await readFile(notesAt, "utf8")).trim()) throw new Error("The notes are empty.");
if (run("git", ["status", "--porcelain"])) throw new Error("Commit the tested change first.");

const current = JSON.parse(await readFile(join(app, "package.json"), "utf8")).version as string;
const version = dry ? current : nextVersion(current, bump!);
const repo = /\nrepo="([^"]+)"\n/.exec(await readFile(join(app, "install.sh"), "utf8"))?.[1];
if (!repo) throw new Error("install.sh names no repo.");
const tag = `med-v${version}`;
if (!dry && run("git", ["ls-remote", "--tags", "origin", tag]))
  throw new Error(`${tag} is already on origin.`);

// The version, where the installer and its guide name it.
if (!dry) {
  const edit = async (path: string, change: (text: string) => string) => {
    const text = await readFile(join(app, path), "utf8");
    const next = change(text);
    if (next === text) throw new Error(`${path} does not name ${current}.`);
    await writeFile(join(app, path), next);
  };
  await edit("package.json", (text) =>
    text.replace(`"version": "${current}"`, `"version": "${version}"`),
  );
  await edit("install.sh", (text) =>
    text.replace(`\nlatest="${current}"\n`, `\nlatest="${version}"\n`),
  );
  await edit("docs/INSTALL.md", (text) => text.replaceAll(current, version));
  run("git", [
    "commit",
    "-q",
    "-m",
    `med: release v${version}`,
    "--",
    "package.json",
    "install.sh",
    "docs/INSTALL.md",
  ]);
}
const commit = run("git", ["rev-parse", "HEAD"]);
say(`${tag} at ${commit.slice(0, 8)}`);

// The web build stays when no source it reads is newer than it.
const webBuilt = await stat(join(app, "dist", "web", "index.html")).catch(() => undefined);
const newer =
  webBuilt &&
  run("find", [
    "src",
    "public",
    "index.html",
    "vite.config.ts",
    "tsconfig.json",
    "../../bun.lock",
    "-newer",
    "dist/web/index.html",
    "-type",
    "f",
    "-print",
  ])
    .split("\n")
    .filter(Boolean);
if (!webBuilt || newer!.length) {
  say(webBuilt ? `web build is older than ${newer![0]}; building it` : "building the web");
  run(process.execPath, ["run", "build:web"]);
}
run(process.execPath, ["run", "build:server"]);
say("built");

const installing = dry ? Promise.resolve() : installHere();
const output = await mkdtemp(join(tmpdir(), "med-release-"));
execFileSync(process.execPath, ["scripts/release-macos.ts", output], {
  cwd: app,
  stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, MED_RELEASE_PREBUILT: "1" },
});
const archive = join(output, `med-v${version}-macos-arm64.tar.gz`);
say(`archived ${archive}`);
if (dry) process.exit(0);

// The tag and its release first: the installer on main names this version.
await runAsync("git", ["tag", tag, commit]);
await runAsync("git", ["push", "-q", "origin", tag]);
await runAsync("gh", [
  "release",
  "create",
  tag,
  "--repo",
  repo,
  "--title",
  `Med v${version}`,
  "--notes-file",
  notesAt!,
  "--latest=false",
  "--verify-tag",
  archive,
  join(output, "SHA256SUMS"),
]);
say(`published https://github.com/${repo}/releases/tag/${tag}`);
await runAsync("git", ["push", "-q", "origin", `${commit}:main`]);
say("pushed main");
await installing;
say("done");

function nextVersion(from: string, step: string) {
  if (/^\d+\.\d+\.\d+$/.test(step)) return step;
  const [major, minor, patch] = from.split(".").map(Number) as [number, number, number];
  if (step === "patch") return `${major}.${minor}.${patch + 1}`;
  if (step === "minor") return `${major}.${minor + 1}.0`;
  if (step === "major") return `${major + 1}.0.0`;
  throw new Error(`Not a version or step: ${step}`);
}

/**
 * This Mac runs the release: the main checkout, whose dist the `med` command
 * runs, moves to the release commit and takes this build, and a Med server
 * that runs restarts with the same command, in a login shell of its own.
 */
async function installHere() {
  const main = run("git", ["worktree", "list", "--porcelain"]).split("\n")[0]!.slice(9);
  const mainApp = join(main, "apps", "med");
  if (resolve(mainApp) !== app) {
    const branch = run("git", ["branch", "--show-current"], main);
    if (branch !== "main") return say(`not installed: ${main} is on ${branch}`);
    await runAsync("git", ["merge", "-q", "--ff-only", commit], main);
    await runAsync("rsync", [
      "-a",
      "--delete",
      `${join(app, "dist")}/`,
      `${join(mainApp, "dist")}/`,
    ]);
  }
  const port = process.env.MED_PORT ?? "6330";
  const listening = () => {
    try {
      return run("lsof", ["-t", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]).split("\n")[0];
    } catch {
      return undefined;
    }
  };
  const pid = listening();
  if (!pid) return say(`installed; no server on ${port} to restart`);
  const command = run("ps", ["-o", "command=", "-p", pid]);
  process.kill(Number(pid));
  for (let i = 0; i < 50 && listening(); i++) await wait(100);
  spawn("/bin/zsh", ["-lc", `exec ${command}`], {
    detached: true,
    stdio: "ignore",
    env: { HOME: process.env.HOME, USER: process.env.USER },
  }).unref();
  for (let i = 0; i < 100 && !listening(); i++) await wait(100);
  say(
    listening()
      ? `installed; Med restarted on ${port}`
      : `installed; Med did not restart on ${port}`,
  );
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const app = resolve(import.meta.dir, "..");
const run = (command: string, args: string[], cwd = app) =>
  execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error("Build this release on an Apple Silicon Mac.");
if (Bun.version !== "1.3.5")
  throw new Error("Use Bun 1.3.5, or update the pinned runtime notice and release checks first.");
if (run("git", ["status", "--porcelain"]))
  throw new Error("Build releases from a clean checkout. Commit changes or use a clean worktree.");
const version = JSON.parse(await readFile(join(app, "package.json"), "utf8")).version;
const commit = run("git", ["rev-parse", "HEAD"]);
const output = resolve(process.argv[2] ?? join(app, "dist", "release"));
const name = `med-v${version}-macos-arm64`;
const stage = join(output, name);
await mkdir(output, { recursive: true });
// Do not silently overwrite a previously tested archive.
await mkdir(stage);
execFileSync(process.execPath, ["run", "build"], { cwd: app, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/build-executable.ts", join(stage, "med")], {
  cwd: app,
  stdio: "inherit",
});
if (run(join(stage, "med"), ["--version"]) !== `med ${version}`)
  throw new Error("Executable version does not match package.json.");
for (const guide of ["usage", "agents", "vaults"])
  if (!run(join(stage, "med"), ["docs", guide]).startsWith("#"))
    throw new Error(`Missing embedded guide: ${guide}`);
await cp(join(app, "LICENSE"), join(stage, "LICENSE"));
await cp(join(app, "docs", "INSTALL.md"), join(stage, "README.md"));
await cp(join(app, "upstream"), join(stage, "licenses", "upstream"), { recursive: true });

// Keep notices for the installed runtime dependency graph, including packages
// whose code is tree-shaken. Resolve from each parent to retain distinct versions.
const seen = new Set<string>();
const notices: string[] = [];
async function collect(directory: string) {
  directory = await realpath(directory);
  if (seen.has(directory)) return;
  seen.add(directory);
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  notices.push(
    `\n## ${pkg.name}@${pkg.version}\nLicense: ${JSON.stringify(pkg.license ?? "See package notices")}\n`,
  );
  const files = (await readdir(directory)).filter((name) =>
    /^(licen[sc]e|copying|notice|third[-_]party)([.-]|$)/i.test(name),
  );
  for (const name of files) {
    const target = join(
      stage,
      "licenses",
      "npm",
      `${pkg.name.replaceAll("/", "_")}@${pkg.version}`,
      name,
    );
    await mkdir(dirname(target), { recursive: true });
    await cp(join(directory, name), target, { recursive: true });
  }
  const required = createRequire(join(directory, "package.json"));
  const dependencies = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  if (directory === app) Object.assign(dependencies, { shiki: "*", "@shikijs/themes": "*" });
  for (const name of Object.keys(dependencies).sort()) {
    let found = false;
    for (const base of required.resolve.paths(name) ?? []) {
      const candidate = join(base, name);
      if (await Bun.file(join(candidate, "package.json")).exists()) {
        await collect(candidate);
        found = true;
        break;
      }
    }
    if (!found && pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name])
      throw new Error(`Missing release dependency ${name} from ${pkg.name}`);
  }
}
await collect(app);
await writeFile(
  join(stage, "licenses", "PACKAGES.md"),
  "# Dependency notices\n" + notices.join("\n"),
);
await writeFile(
  join(stage, "BUILD.json"),
  JSON.stringify(
    {
      version,
      commit,
      bun: Bun.version,
      platform: "darwin",
      arch: "arm64",
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
const archive = join(output, `${name}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-C", output, name], {
  env: { ...process.env, COPYFILE_DISABLE: "1" },
});
const sha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(join(output, "SHA256SUMS"), `${sha256}  ${name}.tar.gz\n`);
console.log(`Release archive: ${archive}\nCommit: ${commit}\nSHA-256: ${sha256}`);

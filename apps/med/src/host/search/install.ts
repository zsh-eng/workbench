import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SEARCH_HELPER_VERSION = "v0.0.0-20260911061844-153817f643cd-symbols-v1";
export const ZOEKT_VERSION = "v0.0.0-20260911061844-153817f643cd";
const TOOL_REVISION = "153817f643cd-v3";
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOG_BYTES = 1024 * 1024;

export function searchCacheRoot(): string {
  return resolve(
    process.env.MED_SEARCH_CACHE ||
      join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "med", "search"),
  );
}

export function searchBinDir(): string {
  return resolve(
    process.env.MED_ZOEKT_BIN ||
      join(searchCacheRoot(), "tools", TOOL_REVISION, `${process.platform}-${process.arch}`),
  );
}

export interface InstalledSearchTools {
  binDir: string;
  indexer: string;
  helper: string;
  version: string;
  alreadyInstalled: boolean;
}

function supportedPlatform() {
  if (!["darwin", "linux"].includes(process.platform) || !["arm64", "x64"].includes(process.arch))
    throw new Error("Indexed search tools support macOS and Linux on arm64 or x64.");
}

async function completeInstall(binDir: string): Promise<boolean> {
  try {
    const metadata = JSON.parse(await readFile(join(binDir, "version.json"), "utf8")) as {
      version?: string;
      revision?: string;
    };
    if (metadata.version !== ZOEKT_VERSION || metadata.revision !== TOOL_REVISION) return false;
    await Promise.all([
      access(join(binDir, "zoekt-git-index"), constants.X_OK),
      access(join(binDir, "med-zoekt"), constants.X_OK),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function helperSource(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Vite splits the host into dist/assets; tests and development use src/host/search.
  for (const candidate of [
    resolve(here, "../tools/zoekt"),
    resolve(here, "../../tools/zoekt"),
    resolve(here, "../../../tools/zoekt"),
  ]) {
    try {
      await access(join(candidate, "go.mod"));
      await access(join(candidate, "main.go"));
      return candidate;
    } catch {
      /* Try the source layout after the installed-package layout. */
    }
  }
  throw new Error(
    "Zoekt setup needs tools/zoekt from a Workbench checkout and Go. Run the checkout CLI with --setup-search; the standalone executable can reuse its installed cache.",
  );
}

/** Explicit setup only. Normal viewer startup never downloads or compiles tools. */
export async function installSearchTools(): Promise<InstalledSearchTools> {
  supportedPlatform();
  const binDir = searchBinDir();
  const result = (alreadyInstalled: boolean): InstalledSearchTools => ({
    binDir,
    indexer: join(binDir, "zoekt-git-index"),
    helper: join(binDir, "med-zoekt"),
    version: ZOEKT_VERSION,
    alreadyInstalled,
  });
  if (await completeInstall(binDir)) return result(true);
  const source = await helperSource();
  const cache = searchCacheRoot();
  await mkdir(cache, { recursive: true, mode: 0o700 });
  await mkdir(dirname(binDir), { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(dirname(binDir), ".setup-"));
  const logPath = join(cache, "setup-search.log");
  const logChunks: Buffer[] = [];
  let logBytes = 0;
  let logTruncated = false;
  const append = (chunk: Buffer) => {
    const remaining = MAX_LOG_BYTES - logBytes;
    if (remaining <= 0) {
      logTruncated = true;
      return;
    }
    logChunks.push(chunk.subarray(0, remaining));
    logBytes += Math.min(remaining, chunk.length);
    if (chunk.length > remaining) logTruncated = true;
  };
  const started = Date.now();
  const env = {
    ...process.env,
    GOCACHE: process.env.GOCACHE || join(cache, "go", "build"),
    GOMODCACHE: process.env.GOMODCACHE || join(cache, "go", "mod"),
    CGO_ENABLED: "0",
  };
  const run = (args: string[]) =>
    new Promise<void>((done, fail) => {
      const remaining = INSTALL_TIMEOUT_MS - (Date.now() - started);
      if (remaining <= 0) {
        fail(new Error("Search tool setup exceeded its 10-minute limit."));
        return;
      }
      append(Buffer.from(`\n$ go ${args.join(" ")}\n`));
      const child = spawn("go", args, {
        cwd: source,
        env,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let failure: Error | undefined;
      let force: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals) => {
        if (child.pid) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            /* Already exited. */
          }
        }
        child.kill(signal);
      };
      const stop = (message: string) => {
        if (failure) return;
        failure = new Error(message);
        kill("SIGTERM");
        force = setTimeout(() => kill("SIGKILL"), 1000);
        force.unref();
      };
      const interrupted = () => stop("Search tool setup was interrupted.");
      process.once("SIGINT", interrupted);
      process.once("SIGTERM", interrupted);
      const timer = setTimeout(
        () => stop("Search tool setup exceeded its 10-minute limit."),
        remaining,
      );
      timer.unref();
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.on("error", (error: NodeJS.ErrnoException) => {
        failure =
          error.code === "ENOENT"
            ? new Error(
                "Go is required only for setup. Install Go 1.25.9 or newer, then run setup-search again.",
              )
            : error;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (force) clearTimeout(force);
        process.removeListener("SIGINT", interrupted);
        process.removeListener("SIGTERM", interrupted);
        if (failure) fail(failure);
        else if (code !== 0)
          fail(
            new Error(
              `Could not build the pinned search tools (Go exit ${code}). Install Go 1.25.9 or newer and check ${logPath}.`,
            ),
          );
        else done();
      });
    });
  try {
    // Both targets resolve through this module's pinned go.mod/go.sum. The
    // official indexer is unchanged; med-zoekt is a small restricted API host.
    await run([
      "build",
      "-mod=readonly",
      "-trimpath",
      "-o",
      join(stage, "zoekt-git-index"),
      "github.com/sourcegraph/zoekt/cmd/zoekt-git-index",
    ]);
    await run(["build", "-mod=readonly", "-trimpath", "-o", join(stage, "med-zoekt"), "."]);
    await Promise.all([
      chmod(join(stage, "zoekt-git-index"), 0o700),
      chmod(join(stage, "med-zoekt"), 0o700),
    ]);
    await writeFile(
      join(stage, "version.json"),
      `${JSON.stringify({ version: ZOEKT_VERSION, revision: TOOL_REVISION, platform: process.platform, arch: process.arch })}\n`,
      { mode: 0o600 },
    );
    try {
      await rename(stage, binDir);
    } catch (error) {
      // A concurrent explicit setup can win publication. Never replace a
      // different or incomplete installation directory without user action.
      if (await completeInstall(binDir)) return result(true);
      throw new Error(
        `Cannot publish search tools to ${binDir}. Move the incomplete directory aside, then run setup-search again.`,
        { cause: error },
      );
    }
    return result(false);
  } finally {
    if (logTruncated) logChunks.push(Buffer.from("\n[Setup log truncated at 1 MiB.]\n"));
    await writeFile(logPath, Buffer.concat(logChunks), { mode: 0o600 });
    await rm(stage, { recursive: true, force: true });
  }
}

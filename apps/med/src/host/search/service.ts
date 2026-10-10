import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { BrowseSource } from "../../shared/browse";
import { browseSearchSchema, type BrowseSearch } from "../../shared/inspect";
import { listBranches, listWorktrees, resolveCommit } from "../repository/history";
import { searchBrowse } from "../repository/inspect";
import { git, runProcess } from "../runtime/process";
import { searchBinDir, searchCacheRoot, ZOEKT_VERSION, SEARCH_HELPER_VERSION } from "./install";

import { discoverCtags, ctagsSetupMessage, type CtagsTool } from "./symbols";
import { symbolSearchSchema, type SymbolSearch } from "../../shared/symbols";

const oid = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
const entrySchema = z.object({
  name: z.string(),
  commit: oid,
  alias: z.string().regex(/^med\/[0-9a-f]{24}$/),
});
const manifestSchema = z.object({ version: z.literal(2), branches: z.array(entrySchema).max(64) });
const healthSchema = z.object({
  version: z.string(),
  branches: z.array(z.object({ name: z.string(), commit: oid })),
});
type IndexedBranch = z.infer<typeof entrySchema>;
export interface SearchIndexStatus {
  state: "ready" | "indexing" | "unavailable" | "error";
  message?: string;
  branches: { name: string; commit: string }[];
}
export interface SearchOptions {
  binDir?: string;
  cacheRoot?: string;
  pollMs?: number;
  debounceMs?: number;
  scheduleIndex?: (work: () => Promise<void>, signal: AbortSignal) => Promise<void>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const alias = (name: string) => `med/${hash(name).slice(0, 24)}`;
const same = (a: IndexedBranch[], b: IndexedBranch[]) => JSON.stringify(a) === JSON.stringify(b);

/** Requests stay on an owned Unix socket; no extra TCP service is exposed. */
function socketJson(
  socketPath: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        path,
        method: payload ? "POST" : "GET",
        signal,
        headers: payload ? { "Content-Type": "application/json" } : {},
      },
      (res) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 2 * 1024 * 1024) res.destroy(new Error("Search response exceeds its limit."));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          if (res.statusCode !== 200)
            return reject(new Error(`Search service returned ${res.statusCode}.`));
          try {
            resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Search service timed out.")));
    req.end(payload);
  });
}

/** A host owns one canonical repository cache, shared by that repository's worktrees. */
export class ZoektSearchService {
  private readonly abort = new AbortController();
  private readonly owner = randomBytes(12).toString("hex");
  private readonly bin: string;
  private ctags?: CtagsTool;
  private directory = "";
  private metadata = "";
  private commonDir = "";
  private writer?: ChildProcess;
  private readonly indexingAbort = new AbortController();
  private closed = false;
  private enabled = false;
  private busy?: Promise<void>;
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private interval?: ReturnType<typeof setInterval>;
  private child?: ChildProcess;
  private socketDir?: string;
  private socketPath?: string;
  private indexed: IndexedBranch[] = [];
  private current: SearchIndexStatus = {
    state: "unavailable",
    message:
      "Indexed search is not set up. Initial Zoekt setup needs the Workbench checkout and Go; see med docs usage.",
    branches: [],
  };

  constructor(
    private readonly repo: string,
    private readonly options: SearchOptions = {},
  ) {
    this.bin = options.binDir ?? searchBinDir();
  }
  status(): SearchIndexStatus {
    return { ...this.current, branches: this.current.branches.map((entry) => ({ ...entry })) };
  }
  private setState(state: SearchIndexStatus["state"], message?: string) {
    this.current = {
      state,
      ...(message ? { message } : {}),
      branches: this.indexed.map(({ name, commit }) => ({ name, commit })),
    };
  }
  async start() {
    if (this.closed || this.enabled || this.indexingAbort.signal.aborted) return;
    if (process.platform !== "darwin" && process.platform !== "linux") return;
    try {
      await Promise.all(
        ["zoekt-git-index", "med-zoekt"].map((name) =>
          access(join(this.bin, name), constants.X_OK),
        ),
      );
    } catch {
      return;
    }
    try {
      this.ctags = await discoverCtags();
      this.commonDir = await realpath(
        (
          await git(this.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
            signal: this.abort.signal,
            maxBytes: 8192,
          })
        )
          .toString("utf8")
          .trim(),
      );
      this.directory = join(
        this.options.cacheRoot ?? searchCacheRoot(),
        "repositories",
        hash(`${ZOEKT_VERSION}:v3:${this.ctags?.version ?? "no-ctags"}:${this.commonDir}`).slice(
          0,
          32,
        ),
      );
      this.metadata = join(this.directory, "manifest.json");
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (!(await this.acquireLock())) {
        this.setState("unavailable", "Another viewer owns this search cache. Using Git search.");
        return;
      }
      this.enabled = true;
      this.interval = setInterval(() => this.refresh(), this.options.pollMs ?? 10_000);
      this.interval.unref();
      this.refresh();
    } catch (error) {
      if (!this.closed)
        this.setState(
          "error",
          `Indexed search unavailable: ${error instanceof Error ? error.message : "setup failed"}`,
        );
    }
  }
  private async acquireLock(): Promise<boolean> {
    const writer = spawn(
      join(this.bin, "med-zoekt"),
      ["--lock", join(this.directory, "writer.flock")],
      {
        stdio: ["pipe", "pipe", "ignore"],
        shell: false,
      },
    );
    writer.stdin?.on("error", () => {});
    const acquired = await new Promise<boolean>((done) => {
      let output = "";
      const timeout = setTimeout(() => {
        writer.kill("SIGKILL");
        done(false);
      }, 5000);
      const finish = (value: boolean) => {
        clearTimeout(timeout);
        done(value);
      };
      writer.once("error", () => finish(false));
      writer.once("close", () => finish(false));
      writer.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output === "locked\n") finish(true);
        else if (output.length > 64) {
          writer.kill("SIGKILL");
          finish(false);
        }
      });
    });
    if (!acquired) {
      writer.stdin?.end();
      return false;
    }
    this.writer = writer;
    writer.once("close", () => {
      if (this.writer !== writer || this.closed) return;
      this.writer = undefined;
      this.enabled = false;
      this.indexingAbort.abort();
      if (this.interval) clearInterval(this.interval);
      this.setState("error", "Search cache ownership was lost. Restart the viewer to retry.");
      void this.stopHelper();
    });
    return true;
  }
  /** Filesystem events only request reconciliation; unchanged commit IDs do not cause a build. */
  refresh() {
    if (!this.enabled || this.closed) return;
    this.dirty = true;
    if (this.timer || this.busy) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.busy = this.drain().finally(() => {
        this.busy = undefined;
        if (this.dirty) this.refresh();
      });
    }, this.options.debounceMs ?? 750);
    this.timer.unref();
  }
  private async drain() {
    while (this.dirty && !this.closed && this.enabled) {
      this.dirty = false;
      try {
        if (this.options.scheduleIndex)
          await this.options.scheduleIndex(() => this.reconcile(), this.abort.signal);
        else await this.reconcile();
      } catch (error) {
        if (!this.closed) {
          this.setState(
            "error",
            "Index update failed. Using Git search; the next check will retry.",
          );
          console.error(`Search index: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
  private async desiredBranches() {
    const trees = await listWorktrees(this.repo, this.abort.signal);
    const branches = await listBranches(this.repo, this.abort.signal, trees);
    const wanted = branches
      .sort(
        (a, b) =>
          Number(!!b.worktreePath || b.current) - Number(!!a.worktreePath || a.current) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, 64)
      .map((branch) => ({ name: branch.name, commit: branch.head, alias: alias(branch.name) }));
    for (const tree of trees) {
      if (wanted.length >= 64) break;
      if (!tree.bare && tree.branch === "Detached HEAD" && oid.safeParse(tree.head).success) {
        const name = `Detached ${hash(tree.path).slice(0, 8)}`;
        wanted.push({ name, commit: tree.head, alias: alias(`detached:${tree.path}`) });
      }
    }
    return wanted.sort((a, b) => a.alias.localeCompare(b.alias));
  }
  private async reconcile() {
    const desired = await this.desiredBranches();
    if (!desired.length) {
      await this.stopHelper();
      this.indexed = [];
      this.setState("unavailable", "No committed branches yet.");
      return;
    }
    const marker = join(this.directory, "building");
    let saved: IndexedBranch[] = [];
    let interrupted = false;
    try {
      await access(marker);
      interrupted = true;
    } catch {
      /* No unfinished build. */
    }
    try {
      saved = manifestSchema.parse(JSON.parse(await readFile(this.metadata, "utf8"))).branches;
    } catch {
      /* A missing or old manifest needs a build. */
    }
    if (!interrupted && same(saved, desired)) {
      try {
        if (!this.child) await this.startHelper(desired);
        this.indexed = desired;
        this.setState("ready");
        return;
      } catch {
        this.indexingAbort.signal.throwIfAborted();
        // A manifest alone is not proof that its shards can still be read.
        interrupted = true;
      }
    }
    this.setState("indexing", "Updating branch index. Using Git search until it is ready.");
    await this.stopHelper();
    await writeFile(marker, this.owner, { mode: 0o600 });
    const cacheRepo = join(this.directory, "repository.git");
    try {
      await access(join(cacheRepo, "HEAD"));
    } catch {
      const temporary = join(this.directory, `clone-${this.owner}`);
      await rm(temporary, { recursive: true, force: true });
      await git(
        this.repo,
        [
          "-c",
          "core.hooksPath=/dev/null",
          "clone",
          "--bare",
          "--no-hardlinks",
          "--",
          this.commonDir,
          temporary,
        ],
        { signal: this.indexingAbort.signal, timeoutMs: 120_000 },
      );
      await rename(temporary, cacheRepo);
    }
    // Materialize new objects: go-git cannot reliably read loose alternate objects.
    // Fetch exact OIDs so a moving source branch cannot alter this build.
    await git(
      cacheRepo,
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-auto-maintenance",
        "--no-recurse-submodules",
        "--",
        this.commonDir,
        ...desired.map((branch) => `+${branch.commit}:refs/heads/${branch.alias}`),
      ],
      {
        signal: this.indexingAbort.signal,
        timeoutMs: 120_000,
      },
    );
    const indexDir = join(this.directory, "index");
    await mkdir(indexDir, { recursive: true, mode: 0o700 });
    const stableSet =
      !interrupted &&
      saved.length === desired.length &&
      saved.every((branch, i) => branch.alias === desired[i]!.alias);
    await runProcess(
      join(this.bin, "zoekt-git-index"),
      [
        "-index",
        indexDir,
        "-branches",
        desired.map((branch) => branch.alias).join(","),
        "-submodules=false",
        ...(this.ctags ? ["-require_ctags"] : ["-disable_ctags"]),
        "-parallelism",
        "2",
        "-file_limit",
        "8388608",
        "-max_trigram_count",
        "1000000",
        ...(stableSet ? ["-delta", "-delta_threshold", "8"] : ["-incremental=false"]),
        cacheRepo,
      ],
      {
        cwd: this.directory,
        signal: this.indexingAbort.signal,
        timeoutMs: 300_000,
        maxBytes: 1024 * 1024,
        env: { GOMAXPROCS: "2", CTAGS_COMMAND: this.ctags?.path, SCIP_CTAGS_COMMAND: "" },
      },
    );
    if (this.closed) return;
    await this.startHelper(desired);
    await writeFile(`${this.metadata}.tmp`, JSON.stringify({ version: 2, branches: desired }), {
      mode: 0o600,
    });
    await rename(`${this.metadata}.tmp`, this.metadata);
    await rm(marker, { force: true });
    this.indexed = desired;
    this.setState("ready");
  }
  private async startHelper(expected: IndexedBranch[]) {
    await this.stopHelper();
    this.indexingAbort.signal.throwIfAborted();
    const socketDir = await mkdtemp(join(tmpdir(), "med-search-"));
    this.socketDir = socketDir;
    this.socketPath = join(socketDir, "search.sock");
    const child = spawn(
      join(this.bin, "med-zoekt"),
      ["--index", join(this.directory, "index"), "--socket", this.socketPath],
      { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, GOMAXPROCS: "2" }, shell: false },
    );
    this.child = child;
    let diagnostic = "";
    child.stdin?.on("error", () => {});
    child.stderr?.on("data", (data: Buffer) => {
      diagnostic = (diagnostic + data.toString("utf8")).slice(-4096);
    });
    child.on("error", (error) => {
      diagnostic = error.message;
    });
    child.once("close", () => {
      if (this.child === child) {
        this.child = undefined;
        this.socketPath = undefined;
        this.socketDir = undefined;
        void rm(socketDir, { recursive: true, force: true });
        this.setState("error", "Search service stopped. Using Git search.");
        this.refresh();
      }
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      this.indexingAbort.signal.throwIfAborted();
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) break;
      try {
        const health = healthSchema.parse(
          await socketJson(this.socketPath, "/health", undefined, this.indexingAbort.signal),
        );
        if (
          health.version !== SEARCH_HELPER_VERSION ||
          health.branches.length !== expected.length ||
          expected.some(
            (branch) =>
              !health.branches.some(
                (item) => item.name === branch.alias && item.commit === branch.commit,
              ),
          )
        )
          throw new Error("Indexed branch versions do not match.");
        return;
      } catch {
        /* Wait for index load and the Unix listener. */
      }
      await delay(50, undefined, { signal: this.indexingAbort.signal });
    }
    await this.stopHelper();
    throw new Error(diagnostic || "Search helper did not load the expected branch index.");
  }
  private async stopHelper() {
    const child = this.child;
    const socketDir = this.socketDir;
    this.socketDir = undefined;
    this.child = undefined;
    this.socketPath = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>((done) => child.once("close", () => done()));
      child.stdin?.end();
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      await closed;
      clearTimeout(force);
    }
    if (socketDir) await rm(socketDir, { recursive: true, force: true });
  }
  async symbols(source: BrowseSource, query: string, signal?: AbortSignal): Promise<SymbolSearch> {
    const bounded = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
    const base: SymbolSearch = { source, query, matches: [], truncated: false, engine: "zoekt" };
    if (!query.trim()) return base;
    if (!this.ctags)
      return {
        ...base,
        unavailable: this.enabled ? ctagsSetupMessage : (this.current.message ?? ctagsSetupMessage),
      };
    const resultSource: BrowseSource =
      source.kind === "commit"
        ? source
        : {
            kind: "commit",
            repo: source.repo,
            oid: await resolveCommit(source.repo, "HEAD", bounded),
          };
    const branch = this.indexed.find((entry) => entry.commit === resultSource.oid);
    if (this.current.state !== "ready" || !branch || !this.socketPath)
      return {
        ...base,
        resultSource,
        unavailable:
          this.current.state === "ready"
            ? "This commit is not indexed. File symbol search is still available."
            : (this.current.message ?? "The symbol index is not ready."),
      };
    const child = this.child;
    try {
      const reply = await socketJson(
        this.socketPath,
        "/search",
        { branch: branch.alias, commit: branch.commit, query, symbols: true },
        bounded,
      );
      const parsed = symbolSearchSchema.pick({ matches: true, truncated: true }).parse(reply);
      if (child !== this.child || this.current.state !== "ready")
        return {
          ...base,
          resultSource,
          unavailable: "The index changed. Retry the symbol search.",
        };
      return { ...base, ...parsed, resultSource };
    } catch {
      bounded.throwIfAborted();
      return {
        ...base,
        resultSource,
        unavailable: "The indexed symbol search could not complete.",
      };
    }
  }
  async search(source: BrowseSource, query: string, signal?: AbortSignal): Promise<BrowseSearch> {
    const bounded = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
    bounded.throwIfAborted();
    const resultSource: BrowseSource =
      source.kind === "commit"
        ? source
        : {
            kind: "commit",
            repo: source.repo,
            oid: await resolveCommit(source.repo, "HEAD", bounded),
          };
    const branch = this.indexed.find((entry) => entry.commit === resultSource.oid);
    const child = this.child;
    if (this.current.state === "ready" && branch && this.socketPath) {
      try {
        const reply = await socketJson(
          this.socketPath,
          "/search",
          { branch: branch.alias, commit: branch.commit, query },
          bounded,
        );
        const parsed = browseSearchSchema
          .pick({ matches: true, truncated: true, reason: true })
          .parse(reply);
        if (this.child === child && this.current.state === "ready")
          return {
            ...parsed,
            source,
            query,
            resultSource,
            engine: "zoekt",
            index: { state: "ready" },
          };
      } catch {
        bounded.throwIfAborted();
        if (this.child === child) {
          this.setState("error", "Indexed search is unavailable. Using Git search.");
          await this.stopHelper();
          this.refresh();
        }
      }
    }
    const fallback = await searchBrowse(resultSource, query, bounded);
    const state = this.status();
    return {
      ...fallback,
      source,
      resultSource,
      engine: "git",
      index: {
        state: state.state,
        message:
          state.state === "ready" ? "This commit is not indexed. Using Git search." : state.message,
      },
    };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    this.indexingAbort.abort();
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    await this.busy;
    await this.stopHelper();
    const writer = this.writer;
    this.writer = undefined;
    if (writer && writer.exitCode === null && writer.signalCode === null) {
      const closed = new Promise<void>((done) => writer.once("close", () => done()));
      writer.stdin?.end();
      const force = setTimeout(() => writer.kill("SIGKILL"), 1000);
      await closed;
      clearTimeout(force);
    }
  }
}

import { spawn, type ChildProcess } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { SourceCatalogue, type SavedSource } from "../vault/sources";
import { VaultIndex } from "../vault/index";
import { resolver } from "../vault/metadata";
import { catalogue } from "../vault/catalogue";
import { markdownAsset } from "../markdown-assets";
import type { RepositoryRegistry } from "../repository/registry";
import { selfCommand } from "./self";
import { HostError } from "../runtime/errors";
import { DEFAULT_PORT, getStateDirectory } from "../runtime/connection";
import { discoverSources } from "./discover";
import { loginItem, setLoginItem } from "./login-item";

/** Quotes a word for a POSIX shell when it needs quoting. */
const shellWord = (word: string) =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;

interface Job {
  state: "queued" | "indexing" | "ready" | "error";
  revision: number;
  error?: string;
  result?: unknown;
}
export class ServiceManager {
  private registry?: RepositoryRegistry;
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private jobs = new Map<string, Job>();
  private pending = new Set<string>();
  private child?: ChildProcess;
  private active?: string;
  private stopped = false;
  private catalogues = new Map<string, Awaited<ReturnType<typeof catalogue>>>();
  private reconcile?: ReturnType<typeof setInterval>;
  private mutations: Promise<unknown> = Promise.resolve();
  onStop: () => void = () => {};
  /** Set by a managed server that can replace itself with the code on disk. */
  onRestart?: () => Promise<void>;
  /** The port this server listens on, for the login item and agent commands. */
  port = DEFAULT_PORT;
  get canRestart() {
    return Boolean(this.onRestart);
  }
  private constructor(
    readonly sources: SourceCatalogue,
    readonly stateDir: string,
  ) {}
  static async open(stateDir: string) {
    return new ServiceManager(await SourceCatalogue.open(stateDir), stateDir);
  }
  /** The shell command that runs this Med, and the options that select this
   * server. Options follow the subcommand: `<command> add <path> <options>`. */
  private cli() {
    const self = selfCommand([]);
    const options: string[] = [];
    if (this.stateDir !== getStateDirectory()) options.push("--state-dir", this.stateDir);
    if (this.port !== DEFAULT_PORT) options.push("--port", String(this.port));
    return {
      command: [self.executable, ...self.args].map(shellWord).join(" "),
      options: options.map(shellWord).join(" "),
    };
  }
  async attach(registry: RepositoryRegistry) {
    this.registry = registry;
    for (const source of this.sources.list()) {
      try {
        await this.sources.require(source.id);
        await this.activate(source);
      } catch (error) {
        this.jobs.set(source.id, { state: "error", revision: 0, error: String(error) });
      }
    }
    this.reconcile = setInterval(() => {
      for (const s of this.sources.list()) if (s.kind === "vault") this.enqueue(s.id);
    }, 60_000);
    this.reconcile.unref();
  }
  private async activate(source: SavedSource) {
    if (source.kind === "repo") {
      await this.registry!.register(source.path);
      return;
    }
    try {
      const watcher = watch(source.path, { recursive: true }, (_event, filename) => {
        const parts = String(filename ?? "").split(/[\\/]/);
        if (
          parts.some(
            (p) => p.startsWith(".") || p === "node_modules" || p === "__pycache__" || p === "venv",
          )
        )
          return;
        clearTimeout(this.timers.get(source.id));
        this.timers.set(
          source.id,
          setTimeout(() => {
            this.timers.delete(source.id);
            this.enqueue(source.id);
          }, 150),
        );
      });
      watcher.on("error", () => {
        watcher.close();
        this.watchers.delete(source.id);
        this.enqueue(source.id);
      });
      this.watchers.set(source.id, watcher);
    } catch {
      /* Periodic reconciliation remains available if native watching is unavailable. */
    }
    this.enqueue(source.id);
  }
  enqueue(id: string) {
    if (this.stopped || !this.sources.list().some((s) => s.id === id && s.kind === "vault")) return;
    this.catalogues.delete(id);
    this.pending.add(id);
    const prior = this.jobs.get(id);
    if (this.active !== id)
      this.jobs.set(id, { ...prior, state: "queued", revision: prior?.revision ?? 0 });
    this.drain();
  }
  private drain() {
    if (this.stopped || this.child || !this.pending.size) return;
    const id = this.pending.values().next().value!;
    this.pending.delete(id);
    this.active = id;
    const revision = this.jobs.get(id)?.revision ?? 0;
    this.jobs.set(id, { state: "indexing", revision });
    const command = selfCommand(["__index-worker", id, "--state-dir", this.sources.stateDir]);
    const child = spawn(command.executable, command.args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    const timeout = setTimeout(() => child.kill(), 120_000);
    let done = false;
    const finish = (error?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      this.child = undefined;
      this.active = undefined;
      if (this.sources.list().some((s) => s.id === id)) {
        if (error) this.jobs.set(id, { state: "error", revision, error });
        else
          try {
            this.jobs.set(id, {
              state: "ready",
              revision: revision + 1,
              result: JSON.parse(stdout),
            });
          } catch {
            this.jobs.set(id, {
              state: "error",
              revision,
              error: "Indexer returned an invalid result.",
            });
          }
      }
      this.drain();
    };
    child.once("error", (error) => finish(error.message));
    child.once("close", (code) =>
      finish(code === 0 ? undefined : stderr || "Index command stopped."),
    );
  }
  snapshot() {
    return this.sources.list().map((s) => ({
      ...s,
      name: basename(s.path),
      index: this.jobs.get(s.id),
      watching: this.watchers.has(s.id),
    }));
  }
  async request(action: string, body: unknown) {
    if (action === "status")
      return { service: "med", version: 1, pid: process.pid, sources: this.snapshot() };
    // First-run setup: what is registered, where to find more, and the login item.
    if (action === "setup")
      return {
        sources: this.snapshot(),
        login: await loginItem(this.stateDir),
        cli: this.cli(),
      };
    if (action === "discover") {
      const { deep } = z.object({ deep: z.boolean().default(false) }).parse(body ?? {});
      return discoverSources({ deep });
    }
    if (action === "login") {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(body);
      return setLoginItem(this.stateDir, this.port, enabled);
    }
    if (action === "stop") {
      setTimeout(() => this.onStop(), 25);
      return { stopping: true };
    }
    if (action === "restart") {
      if (!this.onRestart)
        throw new HostError("restart-unavailable", "Restart this server from its terminal.", 409);
      await this.onRestart();
      return { restarting: true };
    }
    if (action === "add" || action === "remove") {
      const work = this.mutations.then(async () => {
        if (action === "add") {
          const input = z
            .object({
              path: z.string().min(1).max(4096),
              kind: z.enum(["repo", "vault"]).optional(),
            })
            .parse(body);
          const path = await realpath(resolve(input.path));
          let kind = input.kind;
          if (!kind) {
            try {
              if ((await stat(join(path, ".obsidian"))).isDirectory()) kind = "vault";
            } catch {}
          }
          if (!kind) kind = "repo";
          const source = await this.sources.add(kind, path);
          if (!this.watchers.has(source.id)) await this.activate(source);
          return { source };
        }
        const { source: input } = z.object({ source: z.string() }).parse(body);
        const source = this.find(input);
        this.sources.remove(source.id);
        this.pending.delete(source.id);
        this.watchers.get(source.id)?.close();
        this.watchers.delete(source.id);
        clearTimeout(this.timers.get(source.id));
        this.timers.delete(source.id);
        this.jobs.delete(source.id);
        if (this.active === source.id) this.child?.kill();
        if (source.kind === "repo") {
          const registered = this.registry!.owner(source.path);
          if (registered) await this.registry!.remove(registered.id);
        }
        return { removed: source.id };
      });
      this.mutations = work.catch(() => {});
      return work;
    }
    if (action === "index") {
      const { source } = z.object({ source: z.string().optional() }).parse(body);
      const targets = source
        ? [this.find(source)]
        : this.sources.list().filter((s) => s.kind === "vault");
      for (const s of targets) {
        if (s.kind !== "vault")
          throw new Error("Repository indexes use the review search service.");
        this.enqueue(s.id);
      }
      return { sources: targets.map((s) => s.id) };
    }
    const input = z
      .object({
        id: z.string(),
        path: z.string().default(""),
        href: z.string().optional(),
        syntax: z.enum(["wiki", "markdown"]).optional(),
      })
      .parse(body);
    const source = await this.sources.require(input.id, "vault");
    if (action === "backlinks") {
      try {
        const index = await VaultIndex.read(source.path, this.sources.indexPath(source.id));
        try {
          return {
            backlinks: index.backlinks(input.path).slice(0, 1000),
            indexedAt: index.indexedAt(),
            index: this.jobs.get(source.id),
          };
        } finally {
          index.close();
        }
      } catch (error) {
        if (this.jobs.get(source.id)?.state === "ready") throw error;
        return { backlinks: [], index: this.jobs.get(source.id) };
      }
    }
    const files = await this.files(source);
    {
      if (action === "files") return { files, index: this.jobs.get(source.id) };
      if (action === "read") {
        const path = resolve(source.path, input.path);
        const rel = relative(source.path, path);
        if (
          !rel ||
          rel.startsWith("..") ||
          isAbsolute(rel) ||
          !files.some((f) => f.path === input.path)
        )
          throw new Error("Choose a file in this vault.");
        if ((await realpath(path)) !== path) throw new Error("Vault symlinks are not supported.");
        return { path, vault: { id: source.id, path: input.path } };
      }
      if (action === "resolve") {
        const target = resolver(files.map((f) => f.path))(input.path, {
          destination: (input.href ?? "").split("#")[0]!,
          syntax: input.syntax ?? "wiki",
        });
        if (!target.target)
          throw new HostError("unresolved-link", `Link is ${target.reason}.`, 404);
        return { path: target.target, fragment: (input.href ?? "").split("#")[1] ?? "" };
      }
      throw new HostError("not-found", "Unknown service action.", 404);
    }
  }
  private async files(source: SavedSource) {
    let files = this.catalogues.get(source.id);
    if (!files) {
      files = await catalogue(source.path);
      this.catalogues.set(source.id, files);
    }
    return files;
  }
  find(input: string) {
    const matches = this.sources
      .list()
      .filter((s) => s.id === input || s.path === resolve(input) || basename(s.path) === input);
    if (matches.length !== 1)
      throw new Error("Choose an unambiguous source ID or path from med list.");
    return matches[0]!;
  }
  async image(document: string, href: string, syntax: "wiki" | "markdown") {
    const source = this.sources
      .list()
      .filter((s) => s.kind === "vault" && document.startsWith(s.path + "/"))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!source) throw new Error("Open a registered vault before loading its images.");
    await this.sources.require(source.id, "vault");
    {
      const result = resolver((await this.files(source)).map((f) => f.path))(
        relative(source.path, document),
        { destination: href.split("|")[0]!, syntax },
      );
      if (!result.target) throw new Error("Image was not found in this vault.");
      return markdownAsset({ kind: "worktree", repo: source.path }, "index.md", result.target);
    }
  }
  async close() {
    this.stopped = true;
    clearInterval(this.reconcile);
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const watcher of this.watchers.values()) watcher.close();
    if (this.child) {
      const child = this.child;
      await new Promise<void>((done) => {
        child.once("close", () => done());
        child.kill();
      });
    }
    await this.mutations;
    this.sources.close();
  }
}

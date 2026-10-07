import { createHash } from "node:crypto";
import { lstat, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RegisteredRepository } from "../../shared/protocol";
import { HostError } from "../runtime/errors";
import { git } from "../runtime/process";
import { ZoektSearchService, type SearchOptions } from "../search/service";
import { listBranches, listWorktrees, resolveRepository } from "./history";

interface Entry {
  catalogue: RegisteredRepository;
  commonDir: string;
  directoryIdentity: string;
  paths: Set<string>;
  retainedPaths: Set<string>;
  search?: ZoektSearchService;
  searchUsers: number;
  used: number;
}

/** Keep registration and resource ownership in one serialized registry. */
export class RepositoryRegistry {
  private entries = new Map<string, Entry>();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private clock = 0;
  private indexQueue: Promise<unknown> = Promise.resolve();
  // A checkout keeps its common directory while its .git entry is the same
  // file, so most requests check one stat instead of starting Git.
  private checkouts = new Map<string, { marker: string; commonDir: string }>();
  constructor(
    private searchOptions?: SearchOptions,
    private onRemove?: (id: string, paths: ReadonlySet<string>) => Promise<void>,
  ) {}

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => {
      if (this.closed) throw new HostError("host-closed", "The host is closing.", 503);
      return work();
    });
    this.pending = result.catch(() => {});
    return result;
  }

  private async commonDirectory(path: string, signal?: AbortSignal) {
    const marker = await lstat(join(path, ".git")).then(
      (info) => `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.mtimeMs}:${info.size}`,
      () => undefined,
    );
    const known = this.checkouts.get(path);
    if (marker && known?.marker === marker) return known.commonDir;
    const commonDir = await this.findCommonDirectory(path, signal);
    if (marker) {
      if (this.checkouts.size >= 1024) this.checkouts.clear();
      this.checkouts.set(path, { marker, commonDir });
    }
    return commonDir;
  }

  private async findCommonDirectory(path: string, signal?: AbortSignal) {
    return realpath(
      (
        await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
          signal,
          maxBytes: 8192,
        })
      )
        .toString("utf8")
        .trim(),
    );
  }

  private async directoryIdentity(path: string) {
    const info = await stat(path);
    return `${info.dev}:${info.ino}:${info.birthtimeMs}`;
  }

  private async refresh(entry: Entry, signal?: AbortSignal, preferredPath?: string) {
    // The common directory identifies the family even if its first checkout disappears.
    if ((await this.directoryIdentity(entry.commonDir)) !== entry.directoryIdentity)
      throw new HostError(
        "repository-changed",
        "This path now belongs to another repository. Remove it and add it again.",
        409,
      );
    const candidates = new Set([
      entry.catalogue.path,
      ...(preferredPath ? [preferredPath] : []),
      ...entry.paths,
      ...entry.retainedPaths,
    ]);
    let path: string | undefined;
    for (const candidate of candidates) {
      try {
        const canonical = await realpath(candidate);
        if ((await this.commonDirectory(canonical, signal)) === entry.commonDir) {
          path = canonical;
          break;
        }
      } catch {
        signal?.throwIfAborted();
        // Try another checkout from this family; never authorize a different common directory.
      }
    }
    if (!path)
      throw new HostError(
        "repository-unavailable",
        "No working folder is available for this repository. Add an existing worktree.",
        409,
      );
    const worktrees = await listWorktrees(path, signal);
    const paths = new Set<string>([path]);
    const availableWorktrees = [];
    for (const worktree of worktrees) {
      if (worktree.bare) continue;
      try {
        const canonical = await realpath(worktree.path);
        if ((await this.commonDirectory(canonical, signal)) !== entry.commonDir) continue;
        availableWorktrees.push({ ...worktree, path: canonical });
        paths.add(canonical);
        paths.add(resolve(worktree.path));
      } catch {
        signal?.throwIfAborted();
        // Git can retain a prunable entry after its working folder is deleted.
      }
    }
    const branches = await listBranches(path, signal, availableWorktrees);
    if (path !== entry.catalogue.path) {
      await entry.search?.close();
      entry.search = undefined;
    }
    entry.paths = paths;
    for (const path of paths) entry.retainedPaths.add(path);
    entry.catalogue = { ...entry.catalogue, path, branches, worktrees: availableWorktrees };
    delete entry.catalogue.error;
  }

  register(input: string, signal?: AbortSignal) {
    return this.serialize(async () => {
      const info = await resolveRepository(await realpath(resolve(input)), signal);
      const path = await realpath(info.path);
      const commonDir = await this.commonDirectory(path, signal);
      const id = createHash("sha256").update(commonDir).digest("hex").slice(0, 32);
      const previous = this.entries.get(id);
      if (previous) {
        await this.refresh(previous, signal, path);
        return previous.catalogue;
      }
      if (this.entries.size >= 32)
        throw new HostError("repository-limit", "Open at most 32 repositories at one time.", 413);
      const entry: Entry = {
        catalogue: { id, path, name: info.name, branches: [], worktrees: [] },
        commonDir,
        directoryIdentity: await this.directoryIdentity(commonDir),
        paths: new Set([path]),
        retainedPaths: new Set([path]),
        searchUsers: 0,
        used: 0,
      };
      await this.refresh(entry, signal);
      signal?.throwIfAborted();
      this.entries.set(id, entry);
      return entry.catalogue;
    });
  }

  snapshot() {
    return [...this.entries.values()].map((entry) => entry.catalogue);
  }

  refreshOwner(path: string, signal?: AbortSignal) {
    return this.serialize(async () => {
      const owner = this.owner(path);
      const entry = owner && this.entries.get(owner.id);
      if (!entry)
        throw new HostError("repository-not-allowed", "Choose a registered repository.", 403);
      await this.refresh(entry, signal);
      return entry.catalogue;
    });
  }

  list(signal?: AbortSignal) {
    return this.serialize(async () => {
      for (const entry of this.entries.values()) {
        try {
          await this.refresh(entry, signal);
        } catch (error) {
          signal?.throwIfAborted();
          entry.paths.clear();
          await entry.search?.close();
          entry.search = undefined;
          entry.catalogue = {
            ...entry.catalogue,
            branches: [],
            worktrees: [],
            error: error instanceof Error ? error.message : "This repository is unavailable.",
          };
        }
      }
      return this.snapshot();
    });
  }

  owner(path: string) {
    return [...this.entries.values()].find((entry) => entry.paths.has(resolve(path)))?.catalogue;
  }

  async require(input: string, signal?: AbortSignal) {
    let path: string;
    try {
      path = await realpath(resolve(input));
    } catch {
      throw new HostError(
        "repository-not-allowed",
        "Choose an available registered repository or worktree.",
        403,
      );
    }
    const entry = [...this.entries.values()].find((candidate) => candidate.paths.has(path));
    if (!entry)
      throw new HostError(
        "repository-not-allowed",
        "Choose a registered repository or one of its worktrees.",
        403,
      );
    if (
      (await this.commonDirectory(path, signal)) !== entry.commonDir ||
      (await this.directoryIdentity(entry.commonDir)) !== entry.directoryIdentity ||
      this.entries.get(entry.catalogue.id) !== entry
    )
      throw new HostError(
        "repository-not-allowed",
        "This working folder no longer belongs to the registered repository.",
        403,
      );
    return {
      path,
      repository: entry.catalogue,
      valid: () => this.entries.get(entry.catalogue.id) === entry && entry.paths.has(path),
    };
  }

  remove(id: string) {
    return this.serialize(async () => {
      const entry = this.entries.get(id);
      if (!entry)
        throw new HostError("repository-not-found", "This repository is not registered.", 404);
      this.entries.delete(id);
      await this.onRemove?.(id, entry.retainedPaths);
      await entry.search?.close();
      return this.snapshot();
    });
  }

  refreshSearch(path: string) {
    const owner = this.owner(path);
    if (owner) this.entries.get(owner.id)?.search?.refresh();
  }

  /** At most four search services are resident; requests pin a service until complete. */
  async withSearch<T>(path: string, work: (service: ZoektSearchService) => Promise<T> | T) {
    const { entry, search } = await this.serialize(async () => {
      const owner = this.owner(path);
      const entry = owner && this.entries.get(owner.id);
      if (!entry)
        throw new HostError(
          "repository-not-allowed",
          "This repository is no longer registered.",
          403,
        );
      if (!entry.search) {
        const resident = [...this.entries.values()].filter((item) => item.search);
        if (resident.length >= 4) {
          const idle = resident
            .filter((item) => item.searchUsers === 0)
            .sort((a, b) => a.used - b.used)[0];
          if (!idle)
            throw new HostError(
              "busy",
              "Search is busy in other repositories. Retry shortly.",
              503,
            );
          await idle.search!.close();
          idle.search = undefined;
        }
        entry.search = new ZoektSearchService(entry.catalogue.path, {
          ...this.searchOptions,
          scheduleIndex: (work, signal) => {
            const task = this.indexQueue.then(async () => {
              signal.throwIfAborted();
              await work();
            });
            this.indexQueue = task.catch(() => {});
            // A closed service must not wait for another repository's index job.
            return new Promise<void>((done, fail) => {
              const cancelled = () => fail(signal.reason);
              signal.addEventListener("abort", cancelled, { once: true });
              if (signal.aborted) cancelled();
              task.then(done, fail).finally(() => signal.removeEventListener("abort", cancelled));
            });
          },
        });
        await entry.search.start();
      }
      entry.searchUsers++;
      entry.used = ++this.clock;
      return { entry, search: entry.search };
    });
    try {
      return await work(search);
    } finally {
      entry.searchUsers--;
    }
  }

  async close() {
    this.closed = true;
    await this.pending;
    await Promise.allSettled([...this.entries.values()].map((entry) => entry.search?.close()));
    this.entries.clear();
  }
}

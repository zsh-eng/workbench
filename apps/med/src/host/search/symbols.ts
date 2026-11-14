import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, writeFile, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { findSymbolKeys, symbolKeys, type SymbolKey } from "../../shared/symbol-matches";
import type { SymbolMatch, SymbolSearch, SymbolSearchRequest } from "../../shared/symbols";
import { readBrowse } from "../repository/browse";
import { git, runProcess } from "../runtime/process";

export interface CtagsTool {
  path: string;
  version: string;
}
export const ctagsSetupMessage =
  "Install Universal Ctags: brew install universal-ctags (macOS), or sudo pacman -S ctags (Omarchy). Set MED_CTAGS_BIN for a custom binary.";
export async function discoverCtags(): Promise<CtagsTool | undefined> {
  for (const path of process.env.MED_CTAGS_BIN
    ? [process.env.MED_CTAGS_BIN]
    : ["/opt/homebrew/bin/ctags", "/usr/local/bin/ctags", "universal-ctags", "ctags"]) {
    try {
      const result = await runProcess(path, ["--options=NONE", "--version"], {
        cwd: tmpdir(),
        timeoutMs: 2000,
        maxBytes: 8192,
      });
      const version = result.stdout.toString("utf8");
      if (!version.startsWith("Universal Ctags")) continue;
      const features = await runProcess(path, ["--options=NONE", "--list-features"], {
        cwd: tmpdir(),
        timeoutMs: 2000,
        maxBytes: 8192,
      });
      if (/\bjson\b/.test(features.stdout.toString("utf8"))) return { path, version };
    } catch {
      /* Do not accept the macOS system ctags or a broken binary. */
    }
  }
}
const tagSchema = z.object({
  _type: z.literal("tag"),
  name: z.string().min(1).max(4096),
  kind: z.string().optional(),
  line: z.number().int().positive().max(200_000),
  scope: z.string().optional(),
});
export function parseSymbols(
  output: string,
  path: string,
): { matches: SymbolMatch[]; truncated: boolean } {
  const matches: SymbolMatch[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const row of output.split("\n")) {
    if (!row) continue;
    let value: unknown;
    try {
      value = JSON.parse(row);
    } catch {
      continue;
    }
    const parsed = tagSchema.safeParse(value);
    if (!parsed.success) continue;
    const tag = parsed.data;
    const key = JSON.stringify([tag.name, tag.line, tag.kind]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (matches.length >= 10_000) {
      truncated = true;
      break;
    }
    matches.push({
      name: tag.name,
      kind: tag.kind ?? "symbol",
      path,
      line: tag.line,
      ...(tag.scope ? { scope: tag.scope } : {}),
    });
  }
  return { matches, truncated };
}

/** Parse a private copy of the exact bounded snapshot. Never let Ctags follow repo options. */
export class FileSymbolService {
  private readonly cache = new Map<
    string,
    { matches: SymbolMatch[]; truncated: boolean; unavailable?: string }
  >();
  private toolPromise?: Promise<CtagsTool | undefined>;
  constructor(private readonly tool?: CtagsTool) {}
  async search(input: SymbolSearchRequest, signal?: AbortSignal): Promise<SymbolSearch> {
    const base: SymbolSearch = {
      source: input.source,
      path: input.path,
      query: input.query,
      engine: "ctags",
      matches: [],
      truncated: false,
    };
    if (!input.path) return { ...base, unavailable: "Select a file to search its symbols." };
    const file = await readBrowse(input.source, input.path, signal);
    base.identity = file.identity;
    if (input.identity && file.identity !== input.identity)
      return { ...base, unavailable: "This file changed. Reopen it before searching its symbols." };
    if (file.kind !== "text" || file.text === undefined)
      return { ...base, unavailable: file.reason ?? "Symbols require a text file." };
    const tool = this.tool ?? (await (this.toolPromise ??= discoverCtags()));
    if (!tool) return { ...base, unavailable: ctagsSetupMessage };
    const key = createHash("sha256")
      .update(tool.version)
      .update(input.path)
      .update(file.text)
      .digest("hex");
    let result = this.cache.get(key);
    if (!result) {
      const directory = await mkdtemp(join(tmpdir(), "med-symbols-"));
      try {
        const path = join(directory, basename(input.path));
        await writeFile(path, file.text, { mode: 0o600 });
        const language = await runProcess(tool.path, ["--options=NONE", "--print-language", path], {
          cwd: directory,
          signal,
          timeoutMs: 5000,
          maxBytes: 8192,
        });
        if (/NONE\s*$/.test(language.stdout.toString("utf8")))
          result = {
            matches: [],
            truncated: false,
            unavailable: "Universal Ctags does not support this file language.",
          };
        else {
          const output = await runProcess(
            tool.path,
            [
              "--options=NONE",
              "--output-format=json",
              "--fields=+nKZ",
              "--sort=no",
              "-f",
              "-",
              path,
            ],
            { cwd: directory, signal, timeoutMs: 10_000, maxBytes: 8 * 1024 * 1024 },
          );
          result = parseSymbols(output.stdout.toString("utf8"), input.path);
        }
        signal?.throwIfAborted();
        this.cache.set(key, result);
        if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    const query = input.query.toLocaleLowerCase();
    return {
      ...base,
      ...result,
      matches: query
        ? result.matches.filter((match) => match.name.toLocaleLowerCase().includes(query))
        : result.matches,
    };
  }
}

/** Languages whose tags are data, not declarations: one large JSON file can
 * give hundreds of thousands of keys. */
const DATA_LANGUAGES = "-JSON,-SVG,-XML,-PlistXML";
/** Larger files are generated or data, and slow to parse. */
const MAX_TAGGED_BYTES = 1024 * 1024;
/** A line of more bytes than this is minified code or data; the file view
 * shows a file with a line this long, in characters, as plain text
 * (`LONG_LINE` in repository/browse.ts). Its names are not ones a reader
 * looks for, and its preview is slow to paint. */
const LONG_LINE = 20_000;
/** A checkout with more files than this takes its project symbols from the
 * index. */
export const MAX_TAGGED_FILES = 20_000;
/** Files that one Ctags process parses. */
const TAG_BATCH = 200;
/** Ctags processes that run at one time. */
const TAG_PROCESSES = Math.max(1, Math.min(4, availableParallelism() - 1));
/** Checkouts whose symbols stay in memory. */
const MAX_CHECKOUTS = 8;
const pathTagSchema = tagSchema.extend({ path: z.string().min(1) });

interface TaggedFile {
  size: number;
  mtime: number;
  /** Its tags, ready to rank. */
  keys: SymbolKey[];
}

interface Read {
  /** The checkout's token. A read reads the files after its token was
   * taken, so its answer is at least as new. */
  token: string | undefined;
  started: boolean;
  done: boolean;
  /** Undefined: the checkout has too many files. */
  symbols: Promise<SymbolKey[] | undefined>;
}

interface Checkout {
  files: Map<string, TaggedFile>;
  /** The newest read: done, running, or waiting for the one before it. */
  read?: Read;
}

/** The lines of a file, from 1, that are longer than `LONG_LINE` bytes. */
async function longLines(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = await file.readFile();
    const lines = new Set<number>();
    for (let start = 0, line = 1; ; line++) {
      const end = bytes.indexOf(10, start);
      if ((end < 0 ? bytes.length : end) - start > LONG_LINE) lines.add(line);
      if (end < 0) return lines;
      start = end + 1;
    }
  } finally {
    await file.close();
  }
}

/**
 * Symbols in the project of a checkout, without an index: Ctags parses the
 * working files that Git tracks or does not ignore, with their uncommitted
 * changes. A file's tags stay until its size or modification time changes,
 * so a later read parses only the files that changed. Ctags reads no
 * options from the checkout, and links are not followed.
 */
export class WorkingTreeSymbols {
  private readonly checkouts = new Map<string, Checkout>();
  private toolPromise?: Promise<CtagsTool | undefined>;
  constructor(private readonly tool?: CtagsTool) {}
  /**
   * The declarations that best match `query`. An empty query reads the
   * checkout ahead of the first key. Undefined: the checkout is too large for
   * Ctags, and the index answers.
   *
   * `token` names the state of the checkout's files and Git (`checkoutState`
   * in server.ts). While it stays the same, the last read answers without
   * Git or file metadata. Without a token, each search reads again.
   */
  async search(repo: string, query: string, signal?: AbortSignal, token?: string) {
    const source = { kind: "worktree", repo } as const;
    const base: SymbolSearch = {
      source,
      resultSource: source,
      query,
      matches: [],
      truncated: false,
      engine: "ctags",
    };
    const tool = this.tool ?? (await (this.toolPromise ??= discoverCtags()));
    if (!tool) return { ...base, unavailable: ctagsSetupMessage };
    const checkout: Checkout = this.checkouts.get(repo) ?? { files: new Map() };
    this.checkouts.delete(repo);
    this.checkouts.set(repo, checkout);
    while (this.checkouts.size > MAX_CHECKOUTS)
      this.checkouts.delete(this.checkouts.keys().next().value!);
    // One read at a time for each checkout, and at most one waiting. A
    // search joins the read at its token, or the read that waits, which
    // reads the files after the search's token was taken. Its own cancel
    // does not stop a read that others wait on. With no token, it joins only
    // a read that has not finished.
    const last = checkout.read;
    if (last && !last.started) last.token = token;
    else if (!last || last.token !== token || (token === undefined && last.done)) {
      const previous = last?.symbols.catch(() => undefined);
      const read = { token, started: false, done: false } as Read;
      read.symbols = (async () => {
        await previous;
        read.started = true;
        return this.read(repo, tool, checkout.files);
      })();
      checkout.read = read;
      read.symbols.then(
        () => {
          read.done = true;
        },
        () => {
          // A failed read is not an answer.
          if (checkout.read === read) checkout.read = undefined;
        },
      );
    }
    const symbols = await checkout.read!.symbols;
    signal?.throwIfAborted();
    if (!symbols) return undefined;
    return query.trim() ? { ...base, matches: findSymbolKeys(symbols, query.trim(), 100) } : base;
  }
  private async read(repo: string, tool: CtagsTool, files: Map<string, TaggedFile>) {
    const listed = (
      await git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
        maxBytes: 64 * 1024 * 1024,
      })
    )
      .toString("utf8")
      .split("\0")
      .filter((path) => path && !path.includes("\n"));
    const paths = [...new Set(listed)];
    if (paths.length > MAX_TAGGED_FILES) return undefined;
    const present = new Set<string>();
    const changed = new Map<string, { size: number; mtime: number }>();
    for (let start = 0; start < paths.length; start += 256)
      await Promise.all(
        paths.slice(start, start + 256).map(async (path) => {
          const info = await lstat(join(repo, path)).catch(() => undefined);
          if (!info?.isFile() || info.size > MAX_TAGGED_BYTES) return;
          present.add(path);
          const known = files.get(path);
          if (known?.size !== info.size || known.mtime !== info.mtimeMs)
            changed.set(path, { size: info.size, mtime: info.mtimeMs });
        }),
      );
    for (const path of files.keys()) if (!present.has(path)) files.delete(path);
    const batch = [...changed.keys()];
    const parts: string[][] = [];
    for (let start = 0; start < batch.length; start += TAG_BATCH)
      parts.push(batch.slice(start, start + TAG_BATCH));
    let next = 0;
    // Each worker takes the next part; all of them stop before the read
    // ends, so that the next read does not change the files beside them.
    const workers = await Promise.allSettled(
      Array.from({ length: Math.min(TAG_PROCESSES, parts.length) }, async () => {
        while (next < parts.length) await this.tag(repo, tool, parts[next++]!, changed, files);
      }),
    );
    for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
    // In Git's order, so that equal matches keep one order.
    return paths.flatMap((path) => files.get(path)?.keys ?? []);
  }
  /** Parses one part of the changed files and keeps their tags. */
  private async tag(
    repo: string,
    tool: CtagsTool,
    part: string[],
    changed: Map<string, { size: number; mtime: number }>,
    files: Map<string, TaggedFile>,
  ) {
    const output = await runProcess(
      tool.path,
      [
        "--options=NONE",
        `--languages=${DATA_LANGUAGES}`,
        "--output-format=json",
        // Not the pattern: the source line, which no search reads.
        "--fields=+nKZ-P",
        "--sort=no",
        "-f",
        "-",
        "-L",
        "-",
      ],
      { cwd: repo, input: part.join("\n"), timeoutMs: 60_000, maxBytes: 256 * 1024 * 1024 },
    );
    const tags = new Map<string, SymbolMatch[]>(part.map((path) => [path, []]));
    const seen = new Set<string>();
    for (const row of output.stdout.toString("utf8").split("\n")) {
      if (!row) continue;
      let value: unknown;
      try {
        value = JSON.parse(row);
      } catch {
        continue;
      }
      const parsed = pathTagSchema.safeParse(value);
      if (!parsed.success) continue;
      const tag = parsed.data;
      const list = tags.get(tag.path);
      const key = `${tag.path}\0${tag.name}\0${tag.line}\0${tag.kind}`;
      if (!list || seen.has(key) || list.length >= 10_000) continue;
      seen.add(key);
      list.push({
        name: tag.name,
        kind: tag.kind ?? "symbol",
        path: tag.path,
        line: tag.line,
        ...(tag.scope ? { scope: tag.scope } : {}),
      });
    }
    for (const [path, list] of tags) {
      const info = changed.get(path)!;
      // Names on a long line are left out. Only a file of more bytes than a
      // long line can have one. A file that is gone, or is now a link, has
      // no symbols.
      const long =
        list.length && info.size > LONG_LINE
          ? await longLines(join(repo, path)).catch(() => undefined)
          : new Set<number>();
      const kept = long ? list.filter((tag) => !long.has(tag.line)) : [];
      files.set(path, { ...info, keys: symbolKeys(kept) });
    }
  }
}

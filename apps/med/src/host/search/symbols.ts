import { createHash } from "node:crypto";
import { lstat, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { findSymbols } from "../../shared/symbol-matches";
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
/** A checkout with more files than this takes its project symbols from the
 * index. */
const MAX_TAGGED_FILES = 20_000;
/** Files that one Ctags process parses. */
const TAG_BATCH = 500;
const pathTagSchema = tagSchema.extend({ path: z.string().min(1) });

interface TaggedFile {
  size: number;
  mtime: number;
  tags: SymbolMatch[];
}

/**
 * Symbols in the project of a checkout, without an index: Ctags parses the
 * working files that Git tracks or does not ignore, with their uncommitted
 * changes. A file's tags stay until its size or modification time changes,
 * so a later search parses only the files that changed. Ctags reads no
 * options from the checkout, and links are not followed.
 */
export class WorkingTreeSymbols {
  private readonly checkouts = new Map<
    string,
    { files: Map<string, TaggedFile>; reading?: Promise<SymbolMatch[] | undefined> }
  >();
  private toolPromise?: Promise<CtagsTool | undefined>;
  constructor(private readonly tool?: CtagsTool) {}
  /**
   * The declarations that best match `query`. An empty query reads the
   * checkout ahead of the first key. Undefined: the checkout is too large for
   * Ctags, and the index answers.
   */
  async search(repo: string, query: string, signal?: AbortSignal) {
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
    let checkout = this.checkouts.get(repo);
    if (!checkout) this.checkouts.set(repo, (checkout = { files: new Map() }));
    // One read at a time for each checkout: a search during a read waits for
    // it, and its own cancel does not stop the read that others wait on.
    const entry = checkout;
    entry.reading ??= this.read(repo, tool, entry.files).finally(() => {
      entry.reading = undefined;
    });
    const all = await entry.reading;
    signal?.throwIfAborted();
    if (!all) return undefined;
    return query.trim() ? { ...base, matches: findSymbols(all, query.trim(), 100) } : base;
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
    for (let start = 0; start < batch.length; start += TAG_BATCH) {
      const part = batch.slice(start, start + TAG_BATCH);
      const output = await runProcess(
        tool.path,
        [
          "--options=NONE",
          `--languages=${DATA_LANGUAGES}`,
          "--output-format=json",
          "--fields=+nKZ",
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
        const key = JSON.stringify([tag.path, tag.name, tag.line, tag.kind]);
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
      for (const [path, list] of tags) files.set(path, { ...changed.get(path)!, tags: list });
    }
    return [...files.values()].flatMap((file) => file.tags);
  }
}

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isMap, LineCounter, parseDocument } from "yaml";
import {
  frecencyRank,
  PALETTE_SUFFIX,
  paletteFrecencyEntrySchema,
  paletteStepEnvName,
  paletteTupleKey,
  parseDurationMs,
  type PaletteAction,
  type PaletteEntry,
  type PaletteFrecencyEntry,
  type PaletteItem,
  type PaletteItemSource,
  type PaletteProblem,
  type PaletteSpec,
  type PaletteStep,
} from "../shared/palettes";
import type { RegisteredRepository } from "../shared/protocol";
import { parseCsv } from "../web/components/chart/chart-block";
import { HostError } from "./runtime/errors";

// Custom palettes (`*.palette.yaml`): discovered from `~/.config/med/palettes`
// and registered repositories. Step item lists come from static lists, local
// files, or shell commands and are cached on disk with stale-while-revalidate
// semantics so slow internal tools never block palette keystrokes.

const NAME = /^[A-Za-z][\w-]*$/;
const DEFAULT_COMMAND_CACHE_MS = 6 * 3_600_000; // 6 hours
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_MEM_CACHE_ENTRIES = 128;
const MAX_DISK_CACHE_FILES = 256;
const LIST_CACHE_TTL_MS = 2_000;
const MAX_FRECENCY_ENTRIES = 500;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "target",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Parses one `*.palette.yaml` document with line-numbered diagnostics. */
export function parsePalette(
  text: string,
  fallbackTitle = "Palette",
): { spec?: PaletteSpec; problems: PaletteProblem[] } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: true });
  const at = (offset: number | undefined) =>
    offset === undefined ? undefined : lines.linePos(offset).line;
  const problems: PaletteProblem[] = doc.errors.map((error) => ({
    message: error.message.split("\n")[0]!,
    ...(at(error.pos[0]) !== undefined ? { line: at(error.pos[0]) } : {}),
  }));
  if (problems.length) return { problems };
  const lineOf = (path: (string | number)[]) => {
    const node = doc.getIn(path, true) as { range?: [number, number, number] } | undefined;
    return at(node?.range?.[0]);
  };
  const problem = (message: string, path: (string | number)[]) => {
    const line = lineOf(path);
    problems.push({ message, ...(line !== undefined ? { line } : {}) });
  };
  if (!isMap(doc.contents)) {
    problems.push({ message: "A palette is a YAML map with title, steps, and actions." });
    return { problems };
  }
  const raw = doc.toJS() as Record<string, unknown>;
  const title = asString(raw.title)?.trim() || fallbackTitle;
  const description = asString(raw.description)?.trim() || undefined;
  const keyword = asString(raw.keyword)?.trim() || undefined;

  const steps: PaletteStep[] = [];
  const stepNames = new Set<string>();
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  if (!rawSteps.length) {
    problem("Add at least one step under steps:.", ["steps"]);
  }
  rawSteps.forEach((entry, index) => {
    const path = ["steps", index];
    if (!isPlainObject(entry)) {
      problem("Each step is a map with name and source.", path);
      return;
    }
    const name = asString(entry.name)?.trim();
    if (!name || !NAME.test(name)) {
      problem("Step name must start with a letter and use letters, digits, - or _.", [
        ...path,
        "name",
      ]);
      return;
    }
    if (stepNames.has(name)) {
      problem(`Duplicate step name ${name}.`, [...path, "name"]);
      return;
    }
    stepNames.add(name);
    const placeholder = asString(entry.placeholder)?.trim() || name;
    const rawSource = entry.source;
    const source: PaletteItemSource = {};
    if (Array.isArray(entry.options)) {
      source.options = normalizeStaticOptions(entry.options);
    } else if (isPlainObject(rawSource)) {
      if (Array.isArray(rawSource.options))
        source.options = normalizeStaticOptions(rawSource.options);
      const file = asString(rawSource.file)?.trim();
      const command = asString(rawSource.command)?.trim();
      if (file) source.file = file;
      if (command) source.command = command;
      const valueKey = asString(rawSource.value)?.trim();
      const labelKey = asString(rawSource.label)?.trim();
      const subtitleKey = asString(rawSource.subtitle)?.trim();
      const keywordsKey = asString(rawSource.keywords)?.trim();
      if (valueKey) source.value = valueKey;
      if (labelKey) source.label = labelKey;
      if (subtitleKey) source.subtitle = subtitleKey;
      if (keywordsKey) source.keywords = keywordsKey;
    } else if (typeof rawSource === "string" && rawSource.trim()) {
      source.file = rawSource.trim();
    }
    if (!source.options && !source.file && !source.command) {
      problem(`Step ${name} needs options, source.file, or source.command.`, [...path, "source"]);
      return;
    }
    const parsedCache = entry.cache !== undefined ? parseDurationMs(entry.cache) : undefined;
    if (entry.cache !== undefined && parsedCache === null) {
      problem(`Step ${name} has an invalid cache duration.`, [...path, "cache"]);
    }
    const cacheMs = parsedCache ?? (source.command ? DEFAULT_COMMAND_CACHE_MS : 0);
    const dependsOn = Array.isArray(entry.dependsOn)
      ? entry.dependsOn.map(String).filter((dep) => stepNames.has(dep) && dep !== name)
      : [];
    steps.push({
      name,
      placeholder,
      cacheMs,
      dependsOn,
      allowCustom: entry.allowCustom === true,
      source,
    });
  });

  const actions: PaletteAction[] = [];
  const rawActions = Array.isArray(raw.actions) ? raw.actions : [];
  if (!rawActions.length) {
    problem("Add at least one action under actions:.", ["actions"]);
  }
  rawActions.forEach((entry, index) => {
    const path = ["actions", index];
    if (!isPlainObject(entry)) {
      problem("Each action is a map with label and openUrl, openMed, or copy.", path);
      return;
    }
    const label = asString(entry.label)?.trim();
    const openUrl = asString(entry.openUrl)?.trim();
    const openMed = asString(entry.openMed)?.trim();
    const copy = asString(entry.copy);
    if (!label) {
      problem("Action needs a label.", [...path, "label"]);
      return;
    }
    if (!openUrl && !openMed && copy === undefined) {
      problem(`Action "${label}" needs openUrl, openMed, or copy.`, path);
      return;
    }
    actions.push({
      id: `action-${index}`,
      label,
      default: entry.default === true,
      ...(openUrl ? { openUrl } : {}),
      ...(openMed ? { openMed } : {}),
      ...(copy !== undefined ? { copy } : {}),
      copyEncoded: entry.copyEncoded === true,
      confirm: entry.confirm === true,
    });
  });
  // Keep exactly one default action (the first explicitly marked one, else the first valid action).
  const explicitDefault = actions.findIndex((action) => action.default);
  if (explicitDefault >= 0) {
    actions.forEach((action, index) => {
      action.default = index === explicitDefault;
    });
  } else if (actions.length > 0) {
    actions[0]!.default = true;
  }

  if (!steps.length || !actions.length) return { problems };
  return {
    spec: {
      title,
      ...(description ? { description } : {}),
      ...(keyword ? { keyword } : {}),
      steps,
      actions,
    },
    problems,
  };
}

function normalizeStaticOptions(list: unknown[]): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const item of list) {
    if (typeof item === "string" || typeof item === "number") {
      const value = String(item);
      out.push({ value, label: value });
    } else if (isPlainObject(item)) {
      const value = asString(item.value) ?? asString(item.id) ?? asString(item.label);
      if (!value) continue;
      const label = asString(item.label) ?? asString(item.name) ?? value;
      const subtitle = asString(item.subtitle);
      const keywords = Array.isArray(item.keywords)
        ? item.keywords.map(String).join(" ")
        : asString(item.keywords);
      out.push({
        value,
        label,
        ...(subtitle ? { subtitle } : {}),
        ...(keywords ? { keywords } : {}),
      });
    }
  }
  return out;
}

/** Parses JSON array, JSONL, CSV, or plain lines printed by a command/file into PaletteItems. */
export function parseItemsText(text: string, source: PaletteItemSource): PaletteItem[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const toItem = (record: Record<string, unknown>): PaletteItem | null => {
    const value =
      (source.value ? asString(record[source.value]) : undefined) ??
      asString(record.value) ??
      asString(record.id) ??
      asString(record.slug) ??
      asString(record.name);
    if (!value) return null;
    const label =
      (source.label ? asString(record[source.label]) : undefined) ??
      asString(record.label) ??
      asString(record.name) ??
      value;
    const subtitle =
      (source.subtitle ? asString(record[source.subtitle]) : undefined) ??
      asString(record.subtitle);
    const rawKeywords = source.keywords ? record[source.keywords] : record.keywords;
    const keywords = Array.isArray(rawKeywords)
      ? rawKeywords.map(String).join(" ")
      : asString(rawKeywords);
    return {
      value,
      label,
      ...(subtitle ? { subtitle } : {}),
      ...(keywords ? { keywords } : {}),
    };
  };

  // 1. JSON array or object with `items`
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : isPlainObject(parsed) && Array.isArray(parsed.items)
          ? parsed.items
          : null;
      if (list) {
        return list.flatMap((entry) => {
          if (typeof entry === "string" || typeof entry === "number") {
            const value = String(entry);
            return [{ value, label: value }];
          }
          if (isPlainObject(entry)) {
            const item = toItem(entry);
            return item ? [item] : [];
          }
          return [];
        });
      }
    } catch {
      // Fall through to JSONL / CSV / plain lines.
    }
  }

  // 2. JSONL (each non-empty line is a JSON object)
  const rawLines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  if (rawLines.every((line) => line.trim().startsWith("{"))) {
    const items: PaletteItem[] = [];
    let allJson = true;
    for (const line of rawLines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (isPlainObject(parsed)) {
          const item = toItem(parsed);
          if (item) items.push(item);
        } else {
          allJson = false;
          break;
        }
      } catch {
        allJson = false;
        break;
      }
    }
    if (allJson) return items;
  }

  // 3. CSV (when header contains commas)
  if (rawLines[0]!.includes(",")) {
    const table = parseCsv(trimmed);
    if (table.length >= 2) {
      const headers = table[0]!.map((h) => h.trim());
      const valIdx = source.value ? headers.indexOf(source.value) : 0;
      const lblIdx = source.label ? headers.indexOf(source.label) : valIdx;
      const subIdx = source.subtitle ? headers.indexOf(source.subtitle) : -1;
      const kwIdx = source.keywords ? headers.indexOf(source.keywords) : -1;
      const out: PaletteItem[] = [];
      for (const row of table.slice(1)) {
        const value = row[valIdx >= 0 ? valIdx : 0]?.trim();
        if (!value) continue;
        const label = (lblIdx >= 0 ? row[lblIdx]?.trim() : undefined) || value;
        const subtitle = subIdx >= 0 ? row[subIdx]?.trim() || undefined : undefined;
        const keywords = kwIdx >= 0 ? row[kwIdx]?.trim() || undefined : undefined;
        out.push({
          value,
          label,
          ...(subtitle ? { subtitle } : {}),
          ...(keywords ? { keywords } : {}),
        });
      }
      return out;
    }
  }

  // 4. Plain lines
  return rawLines.map((line) => {
    const value = line.trim();
    return { value, label: value };
  });
}

async function walkPalettes(root: string, maxDepth = 4): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await visit(join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile() && entry.name.endsWith(PALETTE_SUFFIX)) {
        found.push(join(dir, entry.name));
      }
    }
  };
  await visit(root, 0);
  return found.sort();
}

function runShell(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    return Promise.reject(
      new HostError("palette-source-aborted", "Palette request cancelled.", 499),
    );
  }
  return new Promise((done, reject) => {
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const out: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failed: HostError | undefined;
    const killGroup = (reason: HostError) => {
      failed ??= reason;
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        /* Already exited. */
      }
    };
    const timer = setTimeout(
      () =>
        killGroup(
          new HostError(
            "palette-source-timeout",
            `Palette source timed out after ${Math.round(timeoutMs / 1000)}s.`,
            504,
          ),
        ),
      timeoutMs,
    );
    timer.unref();
    const onAbort = () =>
      killGroup(new HostError("palette-source-aborted", "Palette request cancelled.", 499));
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        killGroup(
          new HostError("palette-source-large", "Palette source output exceeded 4 MiB.", 502),
        );
        return;
      }
      out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-1000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new HostError("palette-source-failed", error.message, 502));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (failed) return reject(failed);
      if (code !== 0) {
        const last = stderr.trim().split("\n").at(-1)?.trim() || `Exited with status ${code}.`;
        return reject(new HostError("palette-source-failed", last, 502));
      }
      done(Buffer.concat(out).toString("utf8"));
    });
  });
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(
      new HostError("palette-source-aborted", "Palette request cancelled.", 499),
    );
  }
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = () =>
      rejectPromise(new HostError("palette-source-aborted", "Palette request cancelled.", 499));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(value);
      },
      (reason) => {
        signal.removeEventListener("abort", onAbort);
        rejectPromise(reason);
      },
    );
  });
}

async function readSafeSourceFile(
  file: string,
  baseDir: string,
  confinedRoot?: string,
): Promise<string> {
  if (confinedRoot && (file.startsWith("~/") || isAbsolute(file))) {
    throw new HostError(
      "palette-file-untrusted",
      "Repository palettes may only read relative files inside the repository.",
      403,
    );
  }
  const candidate = file.startsWith("~/")
    ? join(homedir(), file.slice(2))
    : isAbsolute(file)
      ? file
      : resolve(baseDir, file);
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(candidate);
  } catch {
    throw new HostError("palette-file-missing", `Palette file not found: ${file}`, 404);
  }
  if (confinedRoot) {
    const resolvedRoot = await realpath(confinedRoot);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
      throw new HostError(
        "palette-file-untrusted",
        "Repository palette file path escapes the repository root.",
        403,
      );
    }
  }
  const info = await stat(resolvedPath);
  if (!info.isFile()) {
    throw new HostError(
      "palette-file-invalid",
      `Palette source is not a regular file: ${file}`,
      400,
    );
  }
  if (info.size > MAX_OUTPUT_BYTES) {
    throw new HostError("palette-file-large", "Palette source file exceeded 4 MiB.", 502);
  }
  return readFile(resolvedPath, "utf8");
}

interface CachedStepData {
  items: PaletteItem[];
  cachedAt: number;
}

export interface PalettesOptions {
  /** Personal palettes folder (`~/.config/med/palettes`). */
  folder: string;
  /** Disk cache directory for slow command sources. */
  cacheDir: string;
  /** Path to the persisted zoxide frecency JSON file. */
  frecencyFile: string;
  repositories():
    | Promise<readonly Pick<RegisteredRepository, "name" | "path">[]>
    | readonly Pick<RegisteredRepository, "name" | "path">[];
  env?(): NodeJS.ProcessEnv;
  now?(): number;
  timeoutMs?: number;
}

interface DiscoveredPalette {
  entry: PaletteEntry;
  trusted: boolean;
  rootDir: string;
}

export function createPalettes(options: PalettesOptions) {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  const memCache = new Map<string, CachedStepData>();
  const inflight = new Map<string, Promise<CachedStepData>>();
  let frecencyCache: PaletteFrecencyEntry[] | undefined;
  let frecencyQueue: Promise<unknown> = Promise.resolve();
  let listCache:
    | {
        at: number;
        folder: string;
        items: DiscoveredPalette[];
        byId: Map<string, DiscoveredPalette>;
      }
    | undefined;

  const paletteIdOf = (where: string, rel: string) =>
    `${where}/${rel.slice(0, -PALETTE_SUFFIX.length).replaceAll("\\", "/")}`;

  const setMemCache = (key: string, data: CachedStepData) => {
    memCache.delete(key);
    memCache.set(key, data);
    while (memCache.size > MAX_MEM_CACHE_ENTRIES) {
      const oldest = memCache.keys().next().value;
      if (oldest === undefined) break;
      memCache.delete(oldest);
    }
  };

  async function pruneDiskCache(): Promise<void> {
    try {
      const names = (await readdir(options.cacheDir)).filter((name) => name.endsWith(".json"));
      if (names.length <= MAX_DISK_CACHE_FILES) return;
      const stamped = await Promise.all(
        names.map(async (name) => {
          const full = join(options.cacheDir, name);
          try {
            const info = await stat(full);
            return { full, mtimeMs: info.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      const sorted = stamped
        .filter((item): item is { full: string; mtimeMs: number } => item !== null)
        .sort((a, b) => a.mtimeMs - b.mtimeMs);
      const excess = sorted.slice(0, Math.max(0, sorted.length - MAX_DISK_CACHE_FILES));
      await Promise.all(excess.map((item) => unlink(item.full).catch(() => {})));
    } catch {
      /* Ignore prune failures. */
    }
  }

  async function parsePaletteFile(
    file: string,
    id: string,
    where: string,
    rel: string,
    trusted: boolean,
    rootDir: string,
  ): Promise<DiscoveredPalette | null> {
    try {
      const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      if (!info.isFile() || info.size > MAX_OUTPUT_BYTES) return null;
      const fallback = basename(file, PALETTE_SUFFIX);
      const parsed = parsePalette(text, fallback);
      const entry: PaletteEntry = {
        id,
        path: file,
        where,
        relative: rel,
        title: parsed.spec?.title ?? fallback,
        ...(parsed.spec?.description ? { description: parsed.spec.description } : {}),
        ...(parsed.spec?.keyword ? { keyword: parsed.spec.keyword } : {}),
        ...(parsed.spec ? { spec: parsed.spec } : {}),
        problems: parsed.problems,
        modified: info.mtimeMs,
      };
      return { entry, trusted, rootDir };
    } catch {
      return null;
    }
  }

  async function discover(force = false): Promise<{
    folder: string;
    items: DiscoveredPalette[];
    byId: Map<string, DiscoveredPalette>;
  }> {
    if (!force && listCache && now() - listCache.at < LIST_CACHE_TTL_MS) {
      return listCache;
    }
    const items: DiscoveredPalette[] = [];
    const byId = new Map<string, DiscoveredPalette>();
    const loadFrom = async (root: string, where: string, idPrefix: string, trusted: boolean) => {
      const files = await walkPalettes(root);
      for (const file of files) {
        const rel = relative(root, file);
        const id = paletteIdOf(idPrefix, rel);
        if (byId.has(id)) continue;
        const found = await parsePaletteFile(file, id, where, rel, trusted, root);
        if (found) {
          items.push(found);
          byId.set(id, found);
        }
      }
    };

    await loadFrom(options.folder, "Personal", "personal", true);
    const repos = await Promise.resolve(options.repositories()).catch(() => []);
    for (const repo of repos) {
      await loadFrom(repo.path, repo.name, repo.name, false);
    }
    listCache = { at: now(), folder: options.folder, items, byId };
    return listCache;
  }

  async function list(): Promise<{ folder: string; palettes: PaletteEntry[] }> {
    const found = await discover(true);
    return { folder: found.folder, palettes: found.items.map((item) => item.entry) };
  }

  async function findPalette(paletteId: string): Promise<DiscoveredPalette | undefined> {
    let found = (await discover(false)).byId.get(paletteId);
    if (!found) {
      found = (await discover(true)).byId.get(paletteId);
    }
    if (!found) return undefined;
    // Re-parse the single file if it was modified on disk since last discovery.
    try {
      const info = await stat(found.entry.path);
      if (info.mtimeMs !== found.entry.modified) {
        const refreshed = await parsePaletteFile(
          found.entry.path,
          found.entry.id,
          found.entry.where,
          found.entry.relative,
          found.trusted,
          found.rootDir,
        );
        if (refreshed) {
          listCache?.byId.set(paletteId, refreshed);
          return refreshed;
        }
      }
    } catch {
      return undefined;
    }
    return found;
  }

  async function readDiskCache(key: string): Promise<CachedStepData | undefined> {
    const mem = memCache.get(key);
    if (mem) return mem;
    const file = join(options.cacheDir, `${key}.json`);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as CachedStepData;
      if (Array.isArray(parsed.items) && typeof parsed.cachedAt === "number") {
        setMemCache(key, parsed);
        return parsed;
      }
    } catch {
      /* Cache miss. */
    }
    return undefined;
  }

  async function writeDiskCache(key: string, data: CachedStepData): Promise<void> {
    setMemCache(key, data);
    await mkdir(options.cacheDir, { recursive: true, mode: 0o700 });
    const target = join(options.cacheDir, `${key}.json`);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, target);
    void pruneDiskCache();
  }

  async function fetchStepItems(
    discovered: DiscoveredPalette,
    step: PaletteStep,
    values: Record<string, string>,
  ): Promise<CachedStepData> {
    const baseDir = dirname(discovered.entry.path);
    if (step.source.options) {
      return { items: step.source.options, cachedAt: now() };
    }
    if (step.source.file) {
      const text = await readSafeSourceFile(
        step.source.file,
        baseDir,
        discovered.trusted ? undefined : discovered.rootDir,
      );
      return { items: parseItemsText(text, step.source), cachedAt: now() };
    }
    if (step.source.command) {
      if (!discovered.trusted) {
        throw new HostError(
          "palette-command-untrusted",
          "Shell commands are only allowed in personal palettes (~/.config/med/palettes).",
          403,
        );
      }
      const baseEnv = options.env ? options.env() : process.env;
      const stepEnv: NodeJS.ProcessEnv = { ...baseEnv };
      for (const [k, v] of Object.entries(values)) {
        stepEnv[paletteStepEnvName(k)] = v;
      }
      const stdout = await runShell(step.source.command, stepEnv, baseDir, timeoutMs);
      return { items: parseItemsText(stdout, step.source), cachedAt: now() };
    }
    return { items: [], cachedAt: now() };
  }

  function cacheKeyOf(
    paletteId: string,
    step: PaletteStep,
    values: Record<string, string>,
  ): string {
    const deps = step.dependsOn
      .slice()
      .sort()
      .map((dep) => [dep, values[dep] ?? ""] as const);
    return createHash("sha256")
      .update(
        JSON.stringify([
          paletteId,
          step.name,
          step.source.command ?? "",
          step.source.file ?? "",
          deps,
        ]),
      )
      .digest("hex")
      .slice(0, 32);
  }

  async function items(
    input: {
      paletteId: string;
      step: string;
      values: Record<string, string>;
      refresh?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<{
    items: PaletteItem[];
    cachedAt: number;
    stale: boolean;
    fromCache: boolean;
    error?: string;
  }> {
    if (signal?.aborted) {
      throw new HostError("palette-source-aborted", "Palette request cancelled.", 499);
    }
    const discovered = await findPalette(input.paletteId);
    const entry = discovered?.entry;
    if (!discovered || !entry?.spec) {
      throw new HostError("palette-not-found", `Palette ${input.paletteId} was not found.`, 404);
    }
    const step = entry.spec.steps.find((s) => s.name === input.step);
    if (!step) {
      throw new HostError(
        "palette-step-not-found",
        `Step ${input.step} does not exist in ${entry.title}.`,
        404,
      );
    }
    // Static options need no disk cache.
    if (step.source.options) {
      return { items: step.source.options, cachedAt: now(), stale: false, fromCache: false };
    }

    // Steps with cacheMs === 0 (e.g. local files or `cache: 0` commands) always read fresh.
    if (step.cacheMs === 0) {
      const fresh = await raceAbort(fetchStepItems(discovered, step, input.values), signal);
      return {
        items: fresh.items,
        cachedAt: fresh.cachedAt,
        stale: false,
        fromCache: false,
      };
    }

    const key = cacheKeyOf(entry.id, step, input.values);
    const cached = !input.refresh ? await readDiskCache(key) : undefined;
    const isStale = !cached || now() - cached.cachedAt > step.cacheMs;

    const runAndStore = (forceFresh: boolean) => {
      if (!forceFresh) {
        const existing = inflight.get(key);
        if (existing) return existing;
      }
      const promise = fetchStepItems(discovered, step, input.values)
        .then(async (fresh) => {
          await writeDiskCache(key, fresh).catch(() => {});
          return fresh;
        })
        .finally(() => {
          if (inflight.get(key) === promise) inflight.delete(key);
        });
      inflight.set(key, promise);
      return promise;
    };

    // Stale-while-revalidate: return cached items immediately (0ms) and refresh quietly in background.
    if (cached && !input.refresh) {
      if (isStale) void runAndStore(false).catch(() => {});
      return {
        items: cached.items,
        cachedAt: cached.cachedAt,
        stale: isStale,
        fromCache: true,
      };
    }

    try {
      const fresh = await raceAbort(runAndStore(Boolean(input.refresh)), signal);
      return {
        items: fresh.items,
        cachedAt: fresh.cachedAt,
        stale: false,
        fromCache: false,
      };
    } catch (error) {
      if (error instanceof HostError && error.code === "palette-source-aborted") {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      // On forced refresh error, fall back to stale cache if available so the user stays unblocked.
      const fallback = await readDiskCache(key);
      if (fallback) {
        return {
          items: fallback.items,
          cachedAt: fallback.cachedAt,
          stale: true,
          fromCache: true,
          error: message,
        };
      }
      throw error;
    }
  }

  async function loadFrecency(): Promise<PaletteFrecencyEntry[]> {
    if (frecencyCache) return frecencyCache;
    try {
      const raw = JSON.parse(await readFile(options.frecencyFile, "utf8")) as unknown;
      if (Array.isArray(raw)) {
        frecencyCache = raw.flatMap((item) => {
          const parsed = paletteFrecencyEntrySchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        });
        return frecencyCache;
      }
    } catch {
      /* Empty history. */
    }
    frecencyCache = [];
    return frecencyCache;
  }

  async function saveFrecency(entries: PaletteFrecencyEntry[]): Promise<void> {
    frecencyCache = entries;
    await mkdir(dirname(options.frecencyFile), { recursive: true, mode: 0o700 });
    const tmp = `${options.frecencyFile}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(entries), { mode: 0o600 });
    await rename(tmp, options.frecencyFile);
  }

  async function listFrecency(): Promise<PaletteFrecencyEntry[]> {
    const entries = await loadFrecency();
    const t = now();
    return [...entries].sort((a, b) => frecencyRank(b, t) - frecencyRank(a, t));
  }

  async function recordVisit(
    paletteId: string,
    values: Record<string, string>,
    labels: Record<string, string>,
  ): Promise<PaletteFrecencyEntry[]> {
    // Serialize read-modify-write so concurrent visits never lose updates or race on rename.
    const next = frecencyQueue.then(async () => {
      const entries = [...(await loadFrecency())];
      const t = now();
      const tupleKey = paletteTupleKey(values);
      const index = entries.findIndex(
        (entry) => entry.paletteId === paletteId && entry.tupleKey === tupleKey,
      );
      if (index >= 0) {
        const existing = entries[index]!;
        entries[index] = {
          ...existing,
          values,
          labels,
          score: existing.score + 1,
          lastVisited: t,
        };
      } else {
        entries.push({
          paletteId,
          tupleKey,
          values,
          labels,
          score: 1,
          lastVisited: t,
        });
      }
      entries.sort((a, b) => frecencyRank(b, t) - frecencyRank(a, t));
      const trimmed = entries.slice(0, MAX_FRECENCY_ENTRIES);
      await saveFrecency(trimmed);
      return trimmed;
    });
    frecencyQueue = next.catch(() => {});
    return next;
  }

  async function clearCache() {
    memCache.clear();
    listCache = undefined;
    await rm(options.cacheDir, { recursive: true, force: true }).catch(() => {});
  }

  return {
    list,
    items,
    listFrecency,
    recordVisit,
    clearCache,
  };
}

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DependencyInfo } from "../shared/generated";

// Licences, release dates, and advisories of npm package versions, from
// deps.dev (docs/GENERATED.md). The browser asks only after the reader turns
// lookups on, and never before the diff shows. A version's answer does not
// change, so the host keeps each one, in memory and in
// `dependency-info.json` in the state directory; a failed lookup is not kept.

const FILE = "dependency-info.json";
/** Answers kept; the oldest go first. */
const MAX_ENTRIES = 4000;
const PARALLEL = 6;
const TIMEOUT_MS = 5000;

type Kept = Omit<DependencyInfo, "name" | "version" | "failed">;

export function createDependencyInfo(options: {
  stateDir: string;
  /** deps.dev's origin; tests give a local server. */
  api?: string;
  fetch?: typeof fetch;
}) {
  const api = options.api ?? "https://api.deps.dev";
  const fetcher = options.fetch ?? globalThis.fetch;
  let kept: Promise<Map<string, Kept>> | undefined;
  let saving: Promise<void> | undefined;
  let dirty = false;
  const load = () =>
    (kept ??= readFile(join(options.stateDir, FILE), "utf8").then(
      (text) => {
        const parsed = JSON.parse(text) as unknown;
        return new Map(
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (Object.entries(parsed) as [string, Kept][])
            : [],
        );
      },
      () => new Map<string, Kept>(),
    ));
  const save = async () => {
    dirty = true;
    if (saving) return saving;
    saving = (async () => {
      while (dirty) {
        dirty = false;
        const entries = [...(await load())].slice(-MAX_ENTRIES);
        const temporary = join(options.stateDir, `.${FILE}.${randomBytes(6).toString("hex")}`);
        await mkdir(options.stateDir, { recursive: true });
        await writeFile(temporary, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
        await rename(temporary, join(options.stateDir, FILE));
      }
    })().finally(() => (saving = undefined));
    return saving;
  };

  const ask = async (name: string, version: string, signal: AbortSignal): Promise<Kept | null> => {
    const url = `${api}/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
    const response = await fetcher(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { unknown: true };
    if (!response.ok) return null;
    const body = (await response.json()) as {
      publishedAt?: unknown;
      licenses?: unknown;
      advisoryKeys?: unknown;
      isDeprecated?: unknown;
    };
    const published = typeof body.publishedAt === "string" ? Date.parse(body.publishedAt) : NaN;
    const licences = Array.isArray(body.licenses)
      ? body.licenses.filter((entry): entry is string => typeof entry === "string")
      : [];
    return {
      ...(licences.length ? { licence: licences.join(" OR ") } : {}),
      ...(Number.isFinite(published) ? { publishedAt: published } : {}),
      ...(Array.isArray(body.advisoryKeys) && body.advisoryKeys.length
        ? { advisories: body.advisoryKeys.length }
        : {}),
      ...(body.isDeprecated === true ? { deprecated: true } : {}),
    };
  };

  return {
    /** Each package version's answer, kept or asked now, in input order. */
    async lookup(
      packages: readonly { name: string; version: string }[],
      signal: AbortSignal,
    ): Promise<DependencyInfo[]> {
      const cache = await load();
      const results: DependencyInfo[] = packages.map(({ name, version }) => ({
        name,
        version,
        ...cache.get(`${name}@${version}`),
      }));
      const missing = results.filter((result) => !cache.has(`${result.name}@${result.version}`));
      const worker = async () => {
        for (let result = missing.shift(); result; result = missing.shift()) {
          const answer = await ask(result.name, result.version, signal).catch(() => null);
          if (!answer) {
            result.failed = true;
            continue;
          }
          Object.assign(result, answer);
          const key = `${result.name}@${result.version}`;
          cache.delete(key);
          cache.set(key, answer);
          while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
          dirty = true;
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (dirty) await save().catch(() => {});
      return results;
    },
  };
}

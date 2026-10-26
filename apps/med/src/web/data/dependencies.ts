import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { generatedRoutes, type DependencyInfo } from "../../shared/generated";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// What a dependency change says in words (docs/GENERATED.md): the direct
// dependencies of a changed package.json, from its two sides, and the
// packages of a lockfile or the entries of a snapshot file, from the patch.

export const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;
export type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

export interface DependencyChange {
  name: string;
  section: DependencySection;
  /** The ranges as the manifest writes them; one is absent for an added or removed dependency. */
  from?: string;
  to?: string;
  /** The version that a range of one version names, without its operator. */
  fromVersion?: string;
  toVersion?: string;
  /** The major version goes up, or the minor version below 1.0. */
  major: boolean;
}

/** The version that a range such as `^8.16.3` or `8.16.3` names, or null. */
export function rangeVersion(range: string | undefined): string | undefined {
  return /^(?:\^|~|=|>=|v)?\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(range?.trim() ?? "")?.[1];
}

/** Whether `to` breaks `from` as semver says: a new major, or a new minor of 0.x. */
export function majorBump(from: string | undefined, to: string | undefined): boolean {
  const parse = (value: string | undefined) =>
    /^(\d+)\.(\d+)/
      .exec(value ?? "")
      ?.slice(1)
      .map(Number);
  const [a, b] = [parse(from), parse(to)];
  if (!a || !b) return false;
  return b[0]! > a[0]! || (a[0] === 0 && b[0] === 0 && b[1]! > a[1]!);
}

function sections(text: string): Map<string, Map<string, string>> | null {
  if (!text.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const result = new Map<string, Map<string, string>>();
  for (const section of DEPENDENCY_SECTIONS) {
    const value = (parsed as Record<string, unknown>)[section];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    result.set(
      section,
      new Map(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    );
  }
  return result;
}

/** The dependencies that differ between two sides of a package.json, by
 * section, then name; null when a side is not JSON. */
export function manifestChanges(before: string, after: string): DependencyChange[] | null {
  const [old, next] = [sections(before), sections(after)];
  if (!old || !next) return null;
  const changes: DependencyChange[] = [];
  for (const section of DEPENDENCY_SECTIONS) {
    const [a, b] = [old.get(section) ?? new Map(), next.get(section) ?? new Map()];
    for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const [from, to] = [a.get(name), b.get(name)];
      if (from === to) continue;
      const [fromVersion, toVersion] = [rangeVersion(from), rangeVersion(to)];
      changes.push({
        name,
        section,
        ...(from !== undefined && { from }),
        ...(to !== undefined && { to }),
        ...(fromVersion && { fromVersion }),
        ...(toVersion && { toVersion }),
        major: majorBump(fromVersion, toVersion),
      });
    }
  }
  return changes;
}

type Line = { side: "context" | "old" | "new"; text: string };
/** Every line that a file's patch shows, in order: context, then each change's
 * old lines and new lines. */
function* patchLines(metadata: FileDiffMetadata): Generator<Line> {
  const clean = (text: string | undefined) => (text ?? "").replace(/\r?\n$/, "");
  for (const hunk of metadata.hunks)
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        for (let index = 0; index < block.lines; index++)
          yield {
            side: "context",
            text: clean(metadata.additionLines[block.additionLineIndex + index]),
          };
        continue;
      }
      for (let index = 0; index < block.deletions; index++)
        yield { side: "old", text: clean(metadata.deletionLines[block.deletionLineIndex + index]) };
      for (let index = 0; index < block.additions; index++)
        yield { side: "new", text: clean(metadata.additionLines[block.additionLineIndex + index]) };
    }
}

// A package and its version on one line: bun.lock (`"pg": ["pg@8.16.3", …`)
// and pnpm-lock.yaml (`  pg@8.16.3:` or `  /pg@8.16.3:`).
const PACKAGE_LINE = [
  /^\s*"[^"]+":\s*\["((?:@[^@"/]+\/)?[^@"]+)@([^"]+)"/,
  /^\s{2,4}'?\/?((?:@[^@\s'/]+\/)?[^@\s'/]+)@(\d[^:(\s']*)'?(?:\(.*\))?:\s*$/,
];
// A package's key, whose version comes on a later line: package-lock.json
// (`"node_modules/pg": {`) and yarn.lock (`pg@^8.0.0:` or `"pg@npm:^8":`).
const PACKAGE_KEY = [
  /^\s*"(?:[^"]*\/)?node_modules\/((?:@[^"/]+\/)?[^"/]+)":\s*\{/,
  /^"?((?:@[^@\s"/]+\/)?[^@\s"/]+)@[^\n]*:\s*$/,
];
const VERSION_LINE = /^\s+"?version"?:?\s+"?([^",\s]+)"?,?\s*$/;

export interface PackageChanges {
  updated: string[];
  added: string[];
  removed: string[];
}
const lockfileCache = new WeakMap<FileDiffMetadata, PackageChanges>();

/** The packages whose versions a lockfile's patch changes, by name. */
export function lockfileChanges(metadata: FileDiffMetadata): PackageChanges {
  const known = lockfileCache.get(metadata);
  if (known) return known;
  const versions = { old: new Map<string, Set<string>>(), new: new Map<string, Set<string>>() };
  const key = { old: "", new: "" };
  const record = (side: "old" | "new", name: string, version: string) => {
    const set = versions[side].get(name) ?? new Set();
    set.add(version);
    versions[side].set(name, set);
  };
  for (const line of patchLines(metadata)) {
    const sides = line.side === "context" ? (["old", "new"] as const) : [line.side];
    const keyed = PACKAGE_KEY.map((rule) => rule.exec(line.text)?.[1]).find(Boolean);
    if (keyed) for (const side of sides) key[side] = keyed;
    if (line.side === "context") continue;
    const same = PACKAGE_LINE.map((rule) => rule.exec(line.text)).find(Boolean);
    if (same) record(line.side, same[1]!, same[2]!);
    else {
      const version = VERSION_LINE.exec(line.text)?.[1];
      if (version && key[line.side]) record(line.side, key[line.side], version);
    }
  }
  const result: PackageChanges = { updated: [], added: [], removed: [] };
  for (const name of new Set([...versions.old.keys(), ...versions.new.keys()])) {
    const [before, after] = [versions.old.get(name), versions.new.get(name)];
    if (before && after) {
      if ([...after].some((version) => !before.has(version))) result.updated.push(name);
    } else (after ? result.added : result.removed).push(name);
  }
  for (const list of Object.values(result)) list.sort();
  lockfileCache.set(metadata, result);
  return result;
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** A lockfile's change in words, leaving out the direct dependencies that the
 * manifests' table shows. */
export function lockfileSummary(changes: PackageChanges, direct: ReadonlySet<string> = new Set()) {
  const [updated, added, removed] = [changes.updated, changes.added, changes.removed].map(
    (names) => names.filter((name) => !direct.has(name)).length,
  ) as [number, number, number];
  const total = updated + added + removed;
  if (!total) return undefined;
  if (total === updated)
    return `${plural(total, "indirect dependency", "indirect dependencies")} updated`;
  const parts = [
    updated && `${updated.toLocaleString()} updated`,
    added && `${added.toLocaleString()} added`,
    removed && `${removed.toLocaleString()} removed`,
  ].filter(Boolean);
  return `${plural(total, "indirect dependency", "indirect dependencies")}: ${parts.join(", ")}`;
}

const SNAPSHOT_KEY = /^exports\[`(.+)`\]\s*=/;
const snapshotCache = new WeakMap<FileDiffMetadata, string | undefined>();

/** A Jest or Vitest snapshot file's change in words: its entries added,
 * removed, and changed. */
export function snapshotSummary(metadata: FileDiffMetadata): string | undefined {
  if (snapshotCache.has(metadata)) return snapshotCache.get(metadata);
  const keys = { old: new Set<string>(), new: new Set<string>() };
  const current = { old: "", new: "" };
  const changed = new Set<string>();
  for (const line of patchLines(metadata)) {
    const key = SNAPSHOT_KEY.exec(line.text)?.[1];
    if (line.side === "context") {
      if (key) current.old = current.new = key;
      continue;
    }
    if (key) {
      keys[line.side].add(key);
      current[line.side] = key;
    } else if (current[line.side]) changed.add(current[line.side]);
  }
  const added = [...keys.new].filter((key) => !keys.old.has(key)).length;
  const removed = [...keys.old].filter((key) => !keys.new.has(key)).length;
  for (const key of keys.new) if (keys.old.has(key)) changed.add(key);
  for (const key of [...keys.new, ...keys.old])
    if (!(keys.new.has(key) && keys.old.has(key))) changed.delete(key);
  const counts = [
    [changed.size, "changed"],
    [added, "added"],
    [removed, "removed"],
  ] as const;
  const total = changed.size + added + removed;
  const only = counts.find(([count]) => count === total);
  const summary = !total
    ? undefined
    : only
      ? `${plural(total, "snapshot", "snapshots")} ${only[1]}`
      : `${plural(total, "snapshot", "snapshots")}: ${counts
          .filter(([count]) => count)
          .map(([count, word]) => `${count} ${word}`)
          .join(", ")}`;
  snapshotCache.set(metadata, summary);
  return summary;
}

export type ManifestState = DependencyChange[] | "loading" | "unavailable";

/**
 * The dependency changes of each changed package.json, read through the
 * review's sources when the card first shows: one manifest at a time, after
 * the diff, so that nothing on the diff's path waits for them.
 */
export function useManifestChanges(
  load: ((path: string) => Promise<{ old: string; new: string }>) | null,
  reviewId: string | null,
  manifests: readonly string[],
): ReadonlyMap<string, ManifestState> {
  const key = JSON.stringify([reviewId, manifests]);
  const [result, setResult] = useState<{ key: string; manifests: Map<string, ManifestState> }>();
  useEffect(() => {
    if (!load || !reviewId || !manifests.length) return;
    let live = true;
    void (async () => {
      for (const path of manifests) {
        const changes = await load(path).then(
          (source) => manifestChanges(source.old, source.new) ?? "unavailable",
          () => "unavailable" as const,
        );
        if (!live) return;
        setResult((current) => {
          const next = new Map(current?.key === key ? current.manifests : []);
          next.set(path, changes);
          return { key, manifests: next };
        });
      }
    })();
    return () => {
      live = false;
    };
    // The key names the review and the manifests.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  return useMemo(() => {
    const states = new Map<string, ManifestState>(
      manifests.map((path) => [path, "loading" as const]),
    );
    if (result?.key === key) for (const [path, state] of result.manifests) states.set(path, state);
    return states;
  }, [key, manifests, result]);
}

// Lookups of licences and release dates are off until the reader turns them
// on; the choice holds for this browser.
const LOOKUPS = "med:dependency-lookups:v1";
const lookupListeners = new Set<() => void>();
const readLookups = () => {
  try {
    return globalThis.localStorage?.getItem(LOOKUPS) === "on";
  } catch {
    return false;
  }
};
export function setDependencyLookups(on: boolean) {
  try {
    if (on) localStorage.setItem(LOOKUPS, "on");
    else localStorage.removeItem(LOOKUPS);
  } catch {
    /* The choice holds until the page reloads. */
  }
  for (const listener of lookupListeners) listener();
}
const subscribeLookups = (listener: () => void) => {
  lookupListeners.add(listener);
  const storage = (event: StorageEvent) => event.key === LOOKUPS && listener();
  window.addEventListener("storage", storage);
  return () => {
    lookupListeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
};
export function useDependencyLookups() {
  return useSyncExternalStore(subscribeLookups, readLookups, () => false);
}

/** The key of a package version in `useDependencyInfo`'s answer. */
export const versionKey = (name: string, version: string) => `${name}@${version}`;

/** deps.dev's answers for these package versions, when lookups are on. */
export function useDependencyInfo(
  fetcher: typeof fetch | undefined,
  packages: readonly { name: string; version: string }[],
  enabled: boolean,
): ReadonlyMap<string, DependencyInfo> | null {
  const key = JSON.stringify(packages.map(({ name, version }) => versionKey(name, version)));
  const [result, setResult] = useState<{ key: string; info: Map<string, DependencyInfo> }>();
  useEffect(() => {
    if (!enabled || !packages.length) return;
    const abort = new AbortController();
    void createApi(fetcher ?? browserFetch, readBrowserToken())
      .call(generatedRoutes.dependencies, { packages: packages.slice(0, 100) }, abort.signal)
      .then((answer) =>
        setResult({
          key,
          info: new Map(answer.packages.map((info) => [versionKey(info.name, info.version), info])),
        }),
      )
      .catch(() => {});
    return () => abort.abort();
    // The key names the packages.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, fetcher]);
  return enabled ? (result?.key === key ? result.info : new Map()) : null;
}

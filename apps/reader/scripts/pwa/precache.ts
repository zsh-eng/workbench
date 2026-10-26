import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

interface ManifestEntry {
  url: string;
  revision: string | null;
  size: number;
}

export interface ReaderPrecacheOptions {
  /**
   * Pages that load on demand. A dynamic import whose module matches one of
   * these starts code that is not precached: the chunks that only such pages
   * load, with their CSS. Code that any other page loads stays precached.
   */
  onDemandPages: readonly RegExp[];
  /** The font files to precache. The others load when text first uses them. */
  precacheFonts: RegExp;
}

/**
 * Decides what the service worker precaches, and writes that list with sizes
 * beside the worker as `sw-precache.json`. While a new version installs, the
 * page counts these entries in Cache Storage to show the update's progress.
 *
 * Everything the build emits is precached, so a fresh install reads offline,
 * except code that only on-demand pages load and fonts outside
 * `precacheFonts`. Those download on first use, into the runtime cache that
 * `vite.config.ts` gives `/assets/`.
 */
export function readerPrecache(options: ReaderPrecacheOptions): {
  plugin: Plugin;
  manifestTransform: (
    entries: ManifestEntry[],
  ) => Promise<{ manifest: ManifestEntry[] }>;
} {
  let outDir: string | null = null;
  const onDemand = new Set<string>();

  return {
    plugin: {
      name: "reader-precache",
      apply: "build",
      configResolved(config) {
        outDir = path.resolve(config.root, config.build.outDir);
      },
      generateBundle(_options, bundle) {
        if (this.environment.name !== "client") return;
        const chunks = Object.values(bundle).filter(
          (item) => item.type === "chunk",
        );
        onDemand.clear();
        for (const file of onDemandFiles(
          chunks,
          (id) => this.getModuleInfo(id)?.dynamicallyImportedIds ?? [],
          options.onDemandPages,
        ))
          onDemand.add(file);
      },
    },
    async manifestTransform(entries) {
      const manifest = entries.filter((entry) => {
        if (onDemand.has(entry.url)) return false;
        if (entry.url.endsWith(".woff2"))
          return options.precacheFonts.test(entry.url);
        return true;
      });
      if (outDir) {
        mkdirSync(outDir, { recursive: true });
        writeFileSync(
          path.join(outDir, "sw-precache.json"),
          JSON.stringify(
            manifest.map(({ url, revision, size }) => ({
              url,
              revision,
              size,
            })),
          ),
        );
      }
      return { manifest };
    },
  };
}

interface BundleChunk {
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  moduleIds: string[];
  imports: string[];
  viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> };
}

/**
 * Files that only on-demand pages reach. The app's entries reach the rest
 * through static imports and through every dynamic import of a module that
 * is not an on-demand page. A file that both reach stays precached, and so
 * does a file that neither reaches.
 */
function onDemandFiles(
  chunks: readonly BundleChunk[],
  dynamicImportsOf: (moduleId: string) => readonly string[],
  onDemandPages: readonly RegExp[],
): string[] {
  const isPage = (moduleId: string) =>
    onDemandPages.some((pattern) => pattern.test(moduleId));
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  // What a dynamic import of a module loads: the chunk that holds the module
  // and the facade chunk that re-exports it, if there is one.
  const loads = new Map<string, string[]>();
  const load = (moduleId: string, fileName: string) =>
    loads.set(moduleId, [...(loads.get(moduleId) ?? []), fileName]);
  for (const chunk of chunks) {
    for (const moduleId of chunk.moduleIds) load(moduleId, chunk.fileName);
    if (chunk.facadeModuleId && !chunk.moduleIds.includes(chunk.facadeModuleId))
      load(chunk.facadeModuleId, chunk.fileName);
  }

  function reach(starts: string[], intoPages: boolean): Set<string> {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length > 0) {
      const fileName = queue.pop()!;
      if (seen.has(fileName)) continue;
      seen.add(fileName);
      const chunk = byName.get(fileName);
      if (!chunk) continue;
      queue.push(...chunk.imports);
      for (const moduleId of chunk.moduleIds)
        for (const target of dynamicImportsOf(moduleId))
          if (intoPages || !isPage(target))
            queue.push(...(loads.get(target) ?? []));
    }
    return seen;
  }

  const app = reach(
    chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
    false,
  );
  const pages = reach(
    [...loads].flatMap(([moduleId, files]) => (isPage(moduleId) ? files : [])),
    true,
  );
  const only = [...pages].filter((fileName) => !app.has(fileName));

  const appFiles = new Set<string>();
  for (const fileName of app)
    for (const file of chunkFiles(byName.get(fileName))) appFiles.add(file);
  const files = new Set(only);
  for (const fileName of only)
    for (const file of chunkFiles(byName.get(fileName)))
      if (!appFiles.has(file)) files.add(file);
  return [...files];
}

function chunkFiles(chunk: BundleChunk | undefined): string[] {
  if (!chunk?.viteMetadata) return [];
  return [
    ...chunk.viteMetadata.importedCss,
    ...chunk.viteMetadata.importedAssets,
  ];
}

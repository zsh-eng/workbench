import { useEffect, useState } from "react";
import {
  DEFAULT_SCENE,
  resolveScene,
  type CoverScene,
  type CoverSceneFile,
} from "./scene";

/**
 * Where scenes come from:
 *
 * - Public-domain covers ship with the app, in `scenes/<name>/`, each with
 *   its own cover so the showcase needs no library.
 * - Scenes for the user's own books are local files. The dev server and
 *   `vite preview` serve them from a git-ignored folder at
 *   `/__living-covers/`; they never enter the repository or a build. A build
 *   asks for them only with `VITE_LOCAL_LIVING_COVERS=1` (the phone preview).
 *
 * Every file passes through one cache, so a scene seen once works offline.
 */

export interface SceneEntry {
  scene: CoverScene;
  /** A cover image to show without the library, when the scene has one. */
  coverUrl: string | null;
  source: "bundled" | "local";
}

const LOCAL_ROOT = "/__living-covers/";
const CACHE_NAME = "reader-living-covers-v1";

const bundledFiles = import.meta.glob<CoverSceneFile>("./scenes/*/scene.json", {
  eager: true,
  import: "default",
});
const bundledAssets = import.meta.glob<string>("./scenes/*/*.{png,webp}", {
  eager: true,
  query: "?url",
  import: "default",
});

function bundledEntries(): SceneEntry[] {
  return Object.entries(bundledFiles).map(([path, file]) => {
    const folder = path.slice(0, path.lastIndexOf("/") + 1);
    const asset = (name: string | undefined) =>
      name ? (bundledAssets[folder + name] ?? null) : null;
    const id = folder.split("/").at(-2)!;
    const base = new URL(window.location.origin);
    const scene = resolveScene(
      id,
      {
        ...file,
        maps: {
          depth: asset(file.maps.depth)!,
          materials: asset(file.maps.materials) ?? undefined,
          life: asset(file.maps.life) ?? undefined,
        },
      },
      base.toString(),
    );
    return { scene, coverUrl: asset("cover.webp"), source: "bundled" };
  });
}

/**
 * Fetch through the scene cache: the network first, so an edited scene
 * shows on reload, then the copy from the last visit when offline.
 */
export async function fetchSceneFile(url: string): Promise<Response> {
  const cache = await openCache();
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    if (cache) await cache.put(url, response.clone());
    return response;
  } catch (error) {
    const cached = await cache?.match(url);
    if (cached) return cached;
    throw error;
  }
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

interface LocalManifest {
  scenes: { id: string; url: string; cover: string | null }[];
}

async function localEntries(): Promise<SceneEntry[]> {
  // Production has no local scenes; see docs/LIVING_COVERS.md for the plan.
  // The phone preview is a local build that asks for them.
  if (!import.meta.env.DEV && !import.meta.env.VITE_LOCAL_LIVING_COVERS)
    return [];
  try {
    const response = await fetchSceneFile(`${LOCAL_ROOT}manifest.json`);
    if (!response.headers.get("content-type")?.includes("json")) return [];
    const manifest = (await response.json()) as LocalManifest;
    const entries = await Promise.all(
      manifest.scenes.map(async (item): Promise<SceneEntry | null> => {
        try {
          const file = (await (
            await fetchSceneFile(item.url)
          ).json()) as CoverSceneFile;
          const base = new URL(item.url, window.location.origin).toString();
          return {
            scene: resolveScene(item.id, file, base),
            coverUrl: item.cover,
            source: "local",
          };
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((entry) => entry !== null);
  } catch {
    return [];
  }
}

let registry: Promise<SceneEntry[]> | null = null;

/** Every scene this origin knows, bundled first. Loaded once per visit. */
export function loadSceneRegistry(): Promise<SceneEntry[]> {
  registry ??= (async () => [...bundledEntries(), ...(await localEntries())])();
  return registry;
}

/** The hand-made scene for a cover, or the default sheen. */
export async function sceneForCover(
  coverFileId: string | null | undefined,
): Promise<CoverScene> {
  if (!coverFileId) return DEFAULT_SCENE;
  const entries = await loadSceneRegistry();
  return (
    entries.find((entry) => entry.scene.covers.includes(coverFileId))?.scene ??
    DEFAULT_SCENE
  );
}

/** The scene for a cover; `null` until the registry has loaded. */
export function useCoverScene(
  coverFileId: string | null | undefined,
): CoverScene | null {
  const [state, setState] = useState<{
    key: string | null | undefined;
    scene: CoverScene;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void sceneForCover(coverFileId).then((scene) => {
      if (!cancelled) setState({ key: coverFileId, scene });
    });
    return () => {
      cancelled = true;
    };
  }, [coverFileId]);
  return state && state.key === coverFileId ? state.scene : null;
}

/** All scenes, for the showcase. */
export function useSceneRegistry(): SceneEntry[] | null {
  const [entries, setEntries] = useState<SceneEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSceneRegistry().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return entries;
}

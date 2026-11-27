import type { Dashboard, DashboardEntry } from "../../shared/dashboards";
import {
  frecencyRank,
  paletteRoutes,
  paletteTupleKey,
  substituteTemplate,
  type PaletteAction,
  type PaletteEntry,
  type PaletteFrecencyEntry,
  type PaletteItem,
  type PaletteSpec,
  type PaletteStep,
} from "../../shared/palettes";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Client cache and helpers for custom palettes (`*.palette.yaml`) and
// Tab-into-Dashboards. Keeping the last responses in memory makes reopening
// ⌘K paint cached choices on frame 0 without a loading flicker.

const api = () => createApi(browserFetch, readBrowserToken());

export interface PaletteItemsResponse {
  items: PaletteItem[];
  cachedAt: number;
  stale: boolean;
  fromCache: boolean;
  error?: string;
}

let lastPalettes: { folder: string; palettes: PaletteEntry[] } | undefined;
let lastFrecency: PaletteFrecencyEntry[] | undefined;
const itemCache = new Map<string, PaletteItemsResponse>();

function itemsKey(paletteId: string, step: string, values: Record<string, string>) {
  return `${paletteId}\0${step}\0${paletteTupleKey(values)}`;
}

export const keptPalettes = () => lastPalettes;
export const keptPaletteFrecency = () => lastFrecency;
export const keptPaletteItems = (paletteId: string, step: string, values: Record<string, string>) =>
  itemCache.get(itemsKey(paletteId, step, values));

/** Resets client-side caches (for tests). */
export function clearPaletteClientCache() {
  lastPalettes = undefined;
  lastFrecency = undefined;
  itemCache.clear();
}

export async function listPalettes(signal?: AbortSignal) {
  lastPalettes = await api().call(paletteRoutes.list, {}, signal);
  return lastPalettes;
}

export async function listPaletteFrecency(signal?: AbortSignal) {
  const result = await api().call(paletteRoutes.frecency, {}, signal);
  lastFrecency = result.entries;
  return result.entries;
}

export async function readPaletteItems(
  input: {
    paletteId: string;
    step: string;
    values: Record<string, string>;
    refresh?: boolean;
  },
  signal?: AbortSignal,
): Promise<PaletteItemsResponse> {
  const result = await api().call(paletteRoutes.items, input, signal);
  itemCache.set(itemsKey(input.paletteId, input.step, input.values), result);
  return result;
}

export async function recordPaletteVisit(input: {
  paletteId: string;
  values: Record<string, string>;
  labels: Record<string, string>;
}): Promise<PaletteFrecencyEntry[]> {
  // Optimistic update so immediately reopening ⌘K reflects the new visit.
  const now = Date.now();
  const tupleKey = paletteTupleKey(input.values);
  if (lastFrecency) {
    const existing = lastFrecency.find(
      (entry) => entry.paletteId === input.paletteId && entry.tupleKey === tupleKey,
    );
    const updated: PaletteFrecencyEntry = existing
      ? {
          ...existing,
          values: { ...input.values },
          labels: { ...input.labels },
          score: existing.score + 1,
          lastVisited: now,
        }
      : {
          paletteId: input.paletteId,
          tupleKey,
          values: { ...input.values },
          labels: { ...input.labels },
          score: 1,
          lastVisited: now,
        };
    lastFrecency = [
      updated,
      ...lastFrecency.filter(
        (entry) => !(entry.paletteId === input.paletteId && entry.tupleKey === tupleKey),
      ),
    ];
  }
  const result = await api().call(paletteRoutes.visit, input);
  lastFrecency = result.entries;
  return result.entries;
}

/** Navigates inside Med via the History API without reloading the document. */
export function openMedAddress(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  try {
    const resolved = new URL(path, location.origin);
    if (resolved.origin !== location.origin) return false;
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (`${location.pathname}${location.search}${location.hash}` !== normalized) {
      history.pushState(null, "", normalized);
    }
    window.dispatchEvent(new PopStateEvent("popstate"));
    return true;
  } catch {
    return false;
  }
}

/** Opens an http(s) URL in a new tab with noopener/noreferrer. */
export function openExternalUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}

/** Synthetic palette ID for a Med dashboard (`dashboard:<id>`). */
export const dashboardPaletteId = (dashboardId: string) => `dashboard:${dashboardId}`;

/**
 * Converts a Med `*.dashboard.yaml` into a multi-step PaletteSpec so users can
 * Tab directly into any dashboard from ⌘K to pick inputs and views.
 */
export function dashboardToPalette(entry: DashboardEntry, dashboard: Dashboard): PaletteSpec {
  const steps: PaletteStep[] = dashboard.inputs.map((input) => {
    const rawOptions = [...(input.options ?? [])];
    if (input.default && !rawOptions.includes(input.default)) {
      rawOptions.unshift(input.default);
    }
    const options: PaletteItem[] = rawOptions.map((value) => {
      const customLabel = input.labels?.[value];
      return {
        value,
        label: customLabel ?? value,
        subtitle: customLabel && customLabel !== value ? value : undefined,
      };
    });
    return {
      name: input.name,
      placeholder: input.label || input.name,
      cacheMs: 0,
      dependsOn: [],
      allowCustom: input.type === "text" || options.length === 0,
      source: { options },
    };
  });

  if (dashboard.views.length > 1) {
    steps.push({
      name: "view",
      placeholder: "View",
      cacheMs: 0,
      dependsOn: [],
      allowCustom: false,
      source: {
        options: dashboard.views.map((view) => ({
          value: view.name,
          label: view.name,
          subtitle: `${view.panels.length} ${view.panels.length === 1 ? "panel" : "panels"}`,
        })),
      },
    });
  }

  const encodedId = entry.id.split("/").map(encodeURIComponent).join("/");
  const queryParts = steps.map((step) =>
    step.name === "view" ? `view=\${view}` : `var-${step.name}=\${${step.name}}`,
  );
  const openPath = queryParts.length
    ? `/dashboards/${encodedId}?${queryParts.join("&")}`
    : `/dashboards/${encodedId}`;
  const origin = typeof location !== "undefined" ? location.origin : "";

  const actions: PaletteAction[] = [
    {
      id: "open-dashboard",
      label: "Open dashboard",
      default: true,
      openMed: openPath,
      copyEncoded: false,
      confirm: false,
    },
    {
      id: "copy-dashboard-link",
      label: "Copy dashboard link",
      default: false,
      copy: `${origin}${openPath}`,
      copyEncoded: true,
      confirm: false,
    },
  ];

  return {
    title: dashboard.title || entry.title,
    description: dashboard.description ?? entry.description,
    steps,
    actions,
  };
}

/** Resolves an action's preview target string for display in the Actions list. */
export function resolveActionPreview(
  action: PaletteAction,
  values: Record<string, string>,
): string {
  if (action.openMed) return substituteTemplate(action.openMed, values, true);
  if (action.openUrl) return substituteTemplate(action.openUrl, values, true);
  if (action.copy !== undefined) {
    return substituteTemplate(action.copy, values, Boolean(action.copyEncoded));
  }
  return "";
}

/** Computes per-item frecency weight for a step given locked prefix values. */
export function stepItemFrecency(
  entries: readonly PaletteFrecencyEntry[],
  paletteId: string,
  stepName: string,
  lockedValues: Record<string, string>,
  now: number,
): Map<string, number> {
  const weights = new Map<string, number>();
  const lockedEntries = Object.entries(lockedValues);
  for (const entry of entries) {
    if (entry.paletteId !== paletteId) continue;
    const value = entry.values[stepName];
    if (!value) continue;
    const rank = frecencyRank(entry, now);
    // Exact prefix match gets full weight; other combinations still give a gentle nudge.
    const prefixMatches = lockedEntries.every(([k, v]) => entry.values[k] === v);
    const boost = prefixMatches ? rank : rank * 0.25;
    weights.set(value, (weights.get(value) ?? 0) + boost);
  }
  return weights;
}

/** Human-readable cache age ("just now", "4m ago", "2h ago"). */
export function formatCacheAge(cachedAt: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - cachedAt);
  if (elapsedMs < 45_000) return "just now";
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(elapsedMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(elapsedMs / 86_400_000);
  return `${days}d ago`;
}

export type TextRanges = [number, number][];

const isWordStart = (text: string, at: number) => at === 0 || /[\s\-/:(·›]/.test(text[at - 1]!);

function mergeRanges(ranges: TextRanges): TextRanges {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const merged: TextRanges = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/**
 * Fuzzy/word-prefix scorer for palette items and frequent tuples.
 * Returns score + highlighted label ranges, or null when unmatched.
 */
export function matchPaletteText(
  label: string,
  keywords: string,
  query: string,
): { score: number; ranges: TextRanges } | null {
  const wanted = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return { score: 0, ranges: [] };
  const text = label.toLowerCase();
  const at = text.indexOf(wanted);
  if (at >= 0) {
    const words = [...text.matchAll(/\S+/g)].map((m) => m.index);
    const start =
      at === 0 ? at : (words.find((index) => index >= at && text.startsWith(wanted, index)) ?? at);
    const score = start === 0 ? 1000 : isWordStart(text, start) ? 900 : 800;
    return { score: score - start, ranges: [[start, start + wanted.length]] };
  }
  const words = wanted.split(" ");
  if (words.length > 1) {
    const ranges: TextRanges = [];
    for (const word of words) {
      let index = -1;
      for (let from = text.indexOf(word); from >= 0; from = text.indexOf(word, from + 1)) {
        if (index < 0) index = from;
        if (isWordStart(text, from)) {
          index = from;
          break;
        }
      }
      if (index < 0) break;
      ranges.push([index, index + word.length]);
    }
    if (ranges.length === words.length) return { score: 650, ranges: mergeRanges(ranges) };
  }
  const lowerKeywords = keywords.toLowerCase();
  if (lowerKeywords.includes(wanted)) return { score: 500, ranges: [] };
  if (
    words.length > 1 &&
    words.every((word) => text.includes(word) || lowerKeywords.includes(word))
  ) {
    const ranges: TextRanges = words.flatMap((word): TextRanges => {
      const index = text.indexOf(word);
      return index >= 0 ? [[index, index + word.length]] : [];
    });
    return { score: 450, ranges: mergeRanges(ranges) };
  }
  if (wanted.includes(" ") || wanted.length < 2) return null;
  // Tight ordered fuzzy match from any word start.
  let best: { score: number; ranges: TextRanges } | null = null;
  for (
    let start = text.indexOf(wanted[0]!);
    start >= 0;
    start = text.indexOf(wanted[0]!, start + 1)
  ) {
    if (!isWordStart(text, start)) continue;
    const ranges: TextRanges = [[start, start + 1]];
    let cursor = start + 1;
    let gap = 0;
    for (const letter of wanted.slice(1)) {
      const index = text.indexOf(letter, cursor);
      if (index < 0) {
        gap = Infinity;
        break;
      }
      gap += index - cursor;
      const last = ranges.at(-1)!;
      if (last[1] === index) last[1] = index + 1;
      else ranges.push([index, index + 1]);
      cursor = index + 1;
    }
    if (gap > wanted.length * 2) continue;
    const score = 300 - gap * 10 - start / 100;
    if (!best || score > best.score) best = { score, ranges };
  }
  return best;
}

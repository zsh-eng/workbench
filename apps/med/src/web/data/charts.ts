import type { z } from "zod";
import { chartRoutes, type GrafanaPanel, type LinkChart } from "../../shared/charts";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Grafana panels for charts, through Med's server, which holds the tokens.

const api = () => createApi(browserFetch, readBrowserToken());

// A page reads four charts at a time, as Med's chart sources run four
// commands at a time, so a chart that waits its turn can say so, and the
// browser keeps connections for the page's other requests.
const AT_ONCE = 4;
let reading = 0;
const turns: (() => void)[] = [];

/** Runs `work` in its turn; `onStart` says when its turn comes. */
async function inTurn<T>(work: () => Promise<T>, signal?: AbortSignal, onStart?: () => void) {
  signal?.throwIfAborted();
  if (reading >= AT_ONCE)
    await new Promise<void>((go, stop) => {
      const turn = () => {
        signal?.removeEventListener("abort", leave);
        go();
      };
      const leave = () => {
        turns.splice(turns.indexOf(turn), 1);
        stop(signal!.reason);
      };
      turns.push(turn);
      signal?.addEventListener("abort", leave, { once: true });
    });
  reading++;
  onStart?.();
  try {
    return await work();
  } finally {
    reading--;
    turns.shift()?.();
  }
}

// Panels this page read, so a chart that scrolls back into view, or a
// thread opened again, draws at once.
const panels = new Map<string, GrafanaPanel>();

type PanelInput = z.input<(typeof chartRoutes)["grafana"]["input"]>;

/** A panel read before, without asking the server. */
export function keptPanel(input: Omit<PanelInput, "refresh">) {
  return panels.get(JSON.stringify(input));
}

export async function grafanaPanel(input: PanelInput, signal?: AbortSignal, onStart?: () => void) {
  const panel = await inTurn(() => api().call(chartRoutes.grafana, input, signal), signal, onStart);
  const key = JSON.stringify({ ...input, refresh: undefined });
  panels.delete(key);
  panels.set(key, panel);
  if (panels.size > 60) panels.delete(panels.keys().next().value!);
  return panel;
}

// What chart sources read, as panels are kept.
const links = new Map<string, LinkChart>();
type LinkInput = z.input<(typeof chartRoutes)["link"]["input"]>;

/** A link's chart read before, without asking the server. */
export function keptLink(input: Omit<LinkInput, "refresh">) {
  return links.get(JSON.stringify(input));
}

/** A link's data from the chart source that covers it. */
export async function linkChart(input: LinkInput, signal?: AbortSignal, onStart?: () => void) {
  const chart = await inTurn(() => api().call(chartRoutes.link, input, signal), signal, onStart);
  const key = JSON.stringify({ ...input, refresh: undefined });
  links.delete(key);
  links.set(key, chart);
  if (links.size > 60) links.delete(links.keys().next().value!);
  return chart;
}

export const grafanaSites = (signal?: AbortSignal) => api().call(chartRoutes.sites, {}, signal);

/** Connects a Grafana with a pasted token, or the Keychain item that holds
 * it; with neither, checks the token Med has. */
export const connectGrafana = (address: string, from?: { token: string } | { keychain: string }) =>
  api().call(chartRoutes.connect, { address, ...from });

export const removeGrafana = (address: string) => api().call(chartRoutes.remove, { address });

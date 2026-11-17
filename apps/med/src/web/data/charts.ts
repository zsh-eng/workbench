import type { z } from "zod";
import { chartRoutes, type GrafanaPanel, type LinkChart } from "../../shared/charts";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Grafana panels for charts, through Med's server, which holds the tokens.

const api = () => createApi(browserFetch, readBrowserToken());

// Panels this page read, so a chart that scrolls back into view, or a
// thread opened again, draws at once.
const panels = new Map<string, GrafanaPanel>();

type PanelInput = z.input<(typeof chartRoutes)["grafana"]["input"]>;

/** A panel read before, without asking the server. */
export function keptPanel(input: Omit<PanelInput, "refresh">) {
  return panels.get(JSON.stringify(input));
}

export async function grafanaPanel(input: PanelInput, signal?: AbortSignal) {
  const panel = await api().call(chartRoutes.grafana, input, signal);
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
export async function linkChart(input: LinkInput, signal?: AbortSignal) {
  const chart = await api().call(chartRoutes.link, input, signal);
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

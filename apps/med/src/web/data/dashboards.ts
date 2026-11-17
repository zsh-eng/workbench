import { dashboardRoutes, type DashboardEntry, type DashboardFile } from "../../shared/dashboards";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// The dashboards that Med's server finds, and one dashboard's file. The page
// keeps the last answers, so a dashboard that shows again draws at once.

const api = () => createApi(browserFetch, readBrowserToken());

let lastList: { folder: string; dashboards: DashboardEntry[] } | undefined;
const files = new Map<string, DashboardFile>();

/** The list read before, without asking the server. */
export const keptDashboards = () => lastList;
export const keptDashboard = (id: string) => files.get(id);

export async function listDashboards(signal?: AbortSignal) {
  lastList = await api().call(dashboardRoutes.list, {}, signal);
  return lastList;
}

export async function readDashboard(id: string, signal?: AbortSignal) {
  const file = await api().call(dashboardRoutes.read, { id }, signal);
  files.set(id, file);
  return file;
}

/** The page's address: /dashboards, or one dashboard's. */
export const DASHBOARDS_PATH = "/dashboards";
export const isDashboardsAddress = (pathname: string) =>
  pathname === DASHBOARDS_PATH || pathname.startsWith(`${DASHBOARDS_PATH}/`);
/** The dashboard that the address names, if any. */
export const dashboardIdOf = (pathname: string) =>
  pathname.startsWith(`${DASHBOARDS_PATH}/`)
    ? pathname
        .slice(DASHBOARDS_PATH.length + 1)
        .split("/")
        .map(decodeURIComponent)
        .join("/")
    : "";
export const dashboardAddress = (id: string) =>
  `${DASHBOARDS_PATH}/${id.split("/").map(encodeURIComponent).join("/")}`;

/** Opens the list, or one dashboard. */
export function openDashboards(id?: string) {
  const address = id ? dashboardAddress(id) : DASHBOARDS_PATH;
  if (`${location.pathname}${location.search}` !== address) history.pushState(null, "", address);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

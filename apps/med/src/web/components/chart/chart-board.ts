import { createContext } from "react";

/** On a dashboard: each panel is outlined on the page and fills its row's
 * height, its tools sit in its header, and the page names the sources once
 * (DashboardsPage.tsx), so a panel's footer would only repeat them. In a
 * reply, a chart stays a card in the prose, with its source below it. */
export const OnBoard = createContext(false);

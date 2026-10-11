import { createContext } from "react";

/** Where a web origin's icon comes from. The page loads images only from Med,
 * so the host fetches each site's icon; the Elements page gives its own. */
export const FaviconSource = createContext<(origin: string) => string>(
  (origin) => `/api/favicon?${new URLSearchParams({ origin })}`,
);

/** A plain globe for a site without an icon. */
export const GLOBE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8c8c8c" stroke-width="1.1"><circle cx="8" cy="8" r="6.3"/><ellipse cx="8" cy="8" rx="2.7" ry="6.3"/><path d="M1.7 8h12.6"/></svg>',
)}`;

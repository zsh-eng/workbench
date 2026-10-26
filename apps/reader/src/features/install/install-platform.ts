/**
 * How this browser can put Reader on the Home Screen or in the Dock.
 * Whether it is already there is `isInstalled`.
 */
export type InstallPlatform =
  /** Safari on iPhone or iPad: its Share sheet → Add to Home Screen. */
  | "ios-safari"
  /** Another browser, or an app's own browser, on iPhone or iPad. */
  | "ios-other"
  /** Chrome, Edge and other Chromium browsers: their install prompt. */
  | "chromium"
  /** Safari on a Mac: File → Add to Dock. */
  | "mac-safari"
  /** No way to install that the sheet can describe. */
  | "other";

/** What the platform is read from; tests and Design ideas pass their own. */
export interface BrowserTraits {
  userAgent: string;
  maxTouchPoints: number;
}

/** Browsers and in-app browsers that use WebKit on iOS but are not Safari. */
const IOS_NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|Pinterest|MicroMessenger|WhatsApp/;

export function installPlatform({
  userAgent,
  maxTouchPoints,
}: BrowserTraits): InstallPlatform {
  if (isIos({ userAgent, maxTouchPoints })) {
    // In-app browsers leave out Safari's Version token.
    const safari = /Version\/[\d.]+.*Safari\//.test(userAgent);
    return safari && !IOS_NOT_SAFARI.test(userAgent)
      ? "ios-safari"
      : "ios-other";
  }
  if (/Firefox\//.test(userAgent)) return "other";
  if (/Chrome\/|Chromium\/|Edg\//.test(userAgent)) return "chromium";
  if (
    /Macintosh/.test(userAgent) &&
    /Version\/[\d.]+.*Safari\//.test(userAgent)
  )
    return "mac-safari";
  return "other";
}

function isIos({ userAgent, maxTouchPoints }: BrowserTraits): boolean {
  if (/iPhone|iPod|iPad/.test(userAgent)) return true;
  // iPadOS asks for desktop sites and says Macintosh; only touch tells.
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** iPad Safari keeps Share in its toolbar; iPhone Safari hides it in a menu. */
export function isIpad({ userAgent, maxTouchPoints }: BrowserTraits): boolean {
  return (
    /iPad/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

/**
 * Safari's major version (26, 27, …), which decides where Share lives on
 * an iPhone. iOS freezes the OS version in the user agent, not Safari's.
 */
export function safariVersion(userAgent: string): number | null {
  const match = /Version\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/**
 * The browser's first step to Share on an iPhone in the Compact tab layout,
 * Safari's default. With Bottom or Top tabs, Share is in the toolbar.
 *
 * - `page-menu`: iOS 27 puts Share in the Page Menu, the button at the left
 *   end of the address bar.
 * - `more`: iOS 26 puts it behind ⋯, beside the address bar.
 * - `toolbar`: earlier versions, and iPad, show Share in the toolbar.
 */
export type ShareEntry = "page-menu" | "more" | "toolbar";

export function shareEntry(traits: BrowserTraits): ShareEntry {
  if (isIpad(traits)) return "toolbar";
  const version = safariVersion(traits.userAgent) ?? 0;
  if (version >= 27) return "page-menu";
  if (version === 26) return "more";
  return "toolbar";
}

/** The display modes of an app opened from the Home Screen or the Dock. */
const INSTALLED_DISPLAY_MODES = [
  "standalone",
  "fullscreen",
  "minimal-ui",
  "window-controls-overlay",
];

/** True when Reader runs as an installed app, not in a browser tab. */
export function isInstalled(): boolean {
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  return INSTALLED_DISPLAY_MODES.some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

export function currentTraits(): BrowserTraits {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  };
}

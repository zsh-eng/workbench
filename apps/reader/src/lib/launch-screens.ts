const SCHEME = / and \(prefers-color-scheme: \w+\)/;

/**
 * Points iOS at the launch screens that match the page. iOS reads these
 * links when Add to Home Screen is tapped and keeps the one image that
 * matches then, so with Light or Dark chosen only that scheme's links match,
 * whatever the system's scheme. Match system keeps each for its scheme.
 * index.html links them all, made by scripts/launch-screens.ts.
 */
export function matchLaunchScreens(scheme: "light" | "dark" | "system"): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="apple-touch-startup-image"]',
  )) {
    const media = (link.dataset.media ??= link.media);
    link.media =
      scheme === "system"
        ? media
        : link.dataset.scheme === scheme
          ? media.replace(SCHEME, "")
          : "not all";
  }
}

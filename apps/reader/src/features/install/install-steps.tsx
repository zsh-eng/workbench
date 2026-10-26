import type { ReactNode } from "react";
import {
  shareEntry,
  safariVersion,
  type BrowserTraits,
  type InstallPlatform,
} from "./install-platform";
import {
  AddToHomeGlyph,
  MoreGlyph,
  PageMenuGlyph,
  SafariChip,
  ShareGlyph,
  ViewMoreGlyph,
  type ChipShape,
} from "./safari-glyphs";

export type SafariStepId =
  | "page-menu"
  | "more"
  | "share"
  | "view-more"
  | "add-to-home"
  | "add";

export interface SafariStep {
  id: SafariStepId;
  /** The control, drawn as Safari draws it. */
  chip: ReactNode;
  /** The control's name, as Safari labels it. */
  name: string;
  /** One short instruction, naming the control in bold. */
  text: ReactNode;
}

function chip(shape: ChipShape, glyph: ReactNode) {
  return <SafariChip shape={shape}>{glyph}</SafariChip>;
}

/** The address bar's left end: the Page Menu, then the site fading out. */
const ADDRESS_BAR_CHIP = (
  <SafariChip shape="bar">
    <PageMenuGlyph className="size-4" />
    <span className="text-[9px] whitespace-nowrap text-muted-foreground">
      reader
    </span>
  </SafariChip>
);

/**
 * The taps from the page to the Home Screen in Safari, checked in the iOS
 * 27 simulator and against iOS 26 guides:
 *
 * - iOS 27: Page Menu (left end of the address bar) → Share → View More →
 *   Add to Home Screen → Add, with Open as Web App on.
 * - iOS 26: ⋯ beside the address bar → Share → View More → … the same.
 * - iPad, earlier iPhones, and the Bottom and Top tab layouts show Share in
 *   the toolbar. Before iOS 26 the share sheet scrolls instead of View More.
 */
export function safariSteps(traits: BrowserTraits): SafariStep[] {
  const entry = shareEntry(traits);
  const modern = (safariVersion(traits.userAgent) ?? 0) >= 26;
  const steps: SafariStep[] = [];
  if (entry === "page-menu")
    steps.push({
      id: "page-menu",
      chip: ADDRESS_BAR_CHIP,
      name: "Page Menu",
      text: (
        <>
          Tap <b>Page Menu</b> in the address bar
        </>
      ),
    });
  if (entry === "more")
    steps.push({
      id: "more",
      chip: chip("round", <MoreGlyph className="size-4" />),
      name: "More",
      text: (
        <>
          Tap <b>⋯</b> beside the address bar
        </>
      ),
    });
  steps.push({
    id: "share",
    chip: chip("row", <ShareGlyph />),
    name: "Share",
    text:
      entry === "toolbar" ? (
        <>
          Tap <b>Share</b> in the toolbar
        </>
      ) : (
        <>
          Tap <b>Share</b>
        </>
      ),
  });
  if (modern)
    steps.push({
      id: "view-more",
      chip: chip("round", <ViewMoreGlyph className="size-4" />),
      name: "View More",
      text: (
        <>
          Tap <b>View More</b>
        </>
      ),
    });
  steps.push({
    id: "add-to-home",
    chip: chip("row", <AddToHomeGlyph />),
    name: "Add to Home Screen",
    text: modern ? (
      <>
        Tap <b>Add to Home Screen</b>
      </>
    ) : (
      <>
        Scroll to <b>Add to Home Screen</b> and tap it
      </>
    ),
  });
  steps.push({
    id: "add",
    chip: <SafariChip shape="pill">Add</SafariChip>,
    name: "Add",
    text: modern ? (
      <>
        Tap <b>Add</b>, with <b>Open as Web App</b> on
      </>
    ) : (
      <>
        Tap <b>Add</b>
      </>
    ),
  });
  return steps;
}

/** One line on why: the words follow the device. */
export function installReason(
  platform: InstallPlatform,
  traits: BrowserTraits,
): string {
  if (platform === "ios-safari" || platform === "ios-other")
    return "Full screen, your library offline, and one tap from your Home Screen.";
  if (/Android/.test(traits.userAgent))
    return "Full screen, your library offline, and one tap from your home screen.";
  return "Its own window, your library offline, and one click to open.";
}

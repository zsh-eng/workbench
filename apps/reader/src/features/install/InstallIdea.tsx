import { ShelfSpecimen } from "@/features/elements/specimens/ShelfSpecimen";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  INSTALL_SHEET_VARIANTS,
  InstallSheet,
  type InstallOutcome,
  type InstallSheetVariant,
} from "./InstallSheet";
import {
  currentTraits,
  installPlatform,
  type BrowserTraits,
  type InstallPlatform,
} from "./install-platform";
import {
  MoreGlyph,
  PageMenuGlyph,
  ReloadGlyph,
  TabsGlyph,
} from "./safari-glyphs";

/** User agents for each platform the idea can show, whatever runs it. */
const USER_AGENTS = {
  "ios-safari-27":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  "ios-safari-26":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  "ios-other":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
} as const;

const PLATFORMS: InstallPlatform[] = ["ios-safari", "ios-other", "chromium"];

function readPlatform(value: string | null): InstallPlatform {
  return PLATFORMS.find((platform) => platform === value) ?? "ios-safari";
}

function readVariant(value: string | null): InstallSheetVariant {
  return INSTALL_SHEET_VARIANTS.find((variant) => variant === value) ?? "list";
}

function traitsFor(platform: InstallPlatform, ios: string): BrowserTraits {
  if (platform === "ios-safari")
    return {
      userAgent:
        ios === "26"
          ? USER_AGENTS["ios-safari-26"]
          : USER_AGENTS["ios-safari-27"],
      maxTouchPoints: 5,
    };
  if (platform === "ios-other")
    return { userAgent: USER_AGENTS["ios-other"], maxTouchPoints: 5 };
  const phone = window.matchMedia("(max-width: 767px)").matches;
  return {
    userAgent: phone ? USER_AGENTS.android : USER_AGENTS.desktop,
    maxTouchPoints: phone ? 5 : 0,
  };
}

/**
 * The install sheet over a sample Library, for any platform and variant:
 * `?platform=ios-safari|ios-other|chromium`, `?variant=list|walkthrough|
 * sentence`, `?ios=26` for iOS 26's ⋯ in place of the Page Menu, and
 * `?books=1` for the note an iPhone shows when books stay in Safari. On an
 * iPhone platform a drawing of Safari's toolbar sits at the bottom, where
 * Safari's own would be. Chrome's Install answers as if accepted, after a
 * moment, where Chrome would show its dialog. `?run=auto` replays the
 * walkthrough's steps for recordings.
 */
export function InstallIdea() {
  const [params] = useSearchParams();
  const platform = readPlatform(params.get("platform"));
  const ios = params.get("ios") ?? "27";
  const framed = window.parent !== window;
  // In Safari itself, Safari's own toolbar is there. Elsewhere the page
  // runs in a frame above a drawing of it, as Safari's page ends above its
  // toolbar, so the sheet rests where it would in Safari.
  const drawToolbar =
    (platform === "ios-safari" || platform === "ios-other") &&
    params.get("inner") !== "1" &&
    installPlatform(currentTraits()) !== "ios-safari";
  const inner = new URLSearchParams(params);
  inner.set("inner", "1");

  return (
    <div className="flex h-dvh flex-col bg-background">
      {!framed && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <Link
            to="/debug/elements/installing"
            aria-label="Back to install ideas"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-sm font-medium">Installing</span>
        </div>
      )}
      {drawToolbar ? (
        <>
          <iframe
            title="Reader in Safari"
            src={`/debug/ideas/installing?${inner}`}
            className="min-h-0 w-full flex-1 border-0"
          />
          <SafariToolbar ios={ios} />
        </>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-auto">
          <IdeaPage platform={platform} ios={ios} />
        </div>
      )}
    </div>
  );
}

/** The sample Library with the sheet over it, opened as the offer opens it. */
function IdeaPage({
  platform,
  ios,
}: {
  platform: InstallPlatform;
  ios: string;
}) {
  const [params] = useSearchParams();
  const variant = readVariant(params.get("variant"));
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);

  // The sheet opens a moment after the page, as the calm-moment offer does.
  useEffect(() => {
    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [round]);

  const install = () =>
    new Promise<InstallOutcome>((resolve) =>
      window.setTimeout(() => resolve("accepted"), 900),
    );

  return (
    <>
      <ShelfSpecimen state="three" nonce={0} />
      {!open && (
        <button
          type="button"
          onClick={() => setRound(round + 1)}
          className="fixed bottom-6 left-1/2 z-40 h-10 -translate-x-1/2 rounded-full bg-foreground px-5 text-[14px] font-medium text-background focus-visible:outline-2 focus-visible:outline-ring"
        >
          Show the sheet again
        </button>
      )}
      <InstallSheet
        key={round}
        isOpen={open}
        onOpenChange={setOpen}
        platform={platform}
        traits={traitsFor(platform, ios)}
        host="reader.zsheng.app"
        onInstall={install}
        booksStayInSafari={
          platform === "ios-safari" && params.get("books") === "1"
        }
        variant={variant}
      />
    </>
  );
}

/**
 * Safari's bottom bar in the Compact layout, drawn where Safari's own sits:
 * iOS 27 has the Page Menu in the address bar and Tabs beside it; iOS 26
 * has ⋯ in Tabs' place.
 */
function SafariToolbar({ ios }: { ios: string }) {
  const circle =
    "grid size-12 shrink-0 place-items-center rounded-full border border-border/80 bg-background/90 shadow-[0_2px_12px_color-mix(in_srgb,var(--foreground)_10%,transparent)] backdrop-blur";
  return (
    <div
      aria-hidden="true"
      className="flex h-[108px] shrink-0 items-start gap-2 px-[34px] pt-[26px] text-foreground"
    >
      <span className={cn(circle, "text-muted-foreground")}>
        <svg viewBox="0 0 24 24" className="size-5">
          <path
            d="M14.5 6 8.5 12l6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-border/80 bg-background/90 px-3 shadow-[0_2px_12px_color-mix(in_srgb,var(--foreground)_10%,transparent)] backdrop-blur">
        <PageMenuGlyph className="size-5" />
        <span className="min-w-0 flex-1 truncate text-center text-[15px]">
          reader.zsheng.app
        </span>
        <ReloadGlyph className="size-[18px]" />
      </span>
      <span className={circle}>
        {ios === "26" ? (
          <MoreGlyph className="size-5" />
        ) : (
          <TabsGlyph className="size-5" />
        )}
      </span>
    </div>
  );
}

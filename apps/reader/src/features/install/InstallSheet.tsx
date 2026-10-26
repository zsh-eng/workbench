import { Button } from "@/components/ui/button";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import { DetentSheet } from "@/components/ui/detent-sheet";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import {
  shareEntry,
  type BrowserTraits,
  type InstallPlatform,
} from "./install-platform";
import { installReason, safariSteps, type SafariStep } from "./install-steps";
import { AppTile, SafariWalkthrough } from "./SafariWalkthrough";
import { PageMenuGlyph, SafariChip } from "./safari-glyphs";

/**
 * How the sheet shows Safari's steps (Design ideas → Installing):
 *
 * - `list`: one row per tap, each with the control as Safari draws it.
 * - `walkthrough`: Safari's screens one at a time, each control opening
 *   into the next as it does in Safari.
 * - `sentence`: the taps as one sentence with the controls inline; the
 *   smallest sheet.
 */
export const INSTALL_SHEET_VARIANTS = [
  "list",
  "walkthrough",
  "sentence",
] as const;
export type InstallSheetVariant = (typeof INSTALL_SHEET_VARIANTS)[number];

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  platform: InstallPlatform;
  traits: BrowserTraits;
  /** Shown as Safari shows the site, in the steps and the header. */
  host: string;
  /** Chromium's install dialog; the sheet's Install button opens it. */
  onInstall: () => Promise<InstallOutcome>;
  /**
   * On iPhone and iPad an installed app keeps its own storage, so books
   * added in Safari stay there unless an account syncs them.
   */
  booksStayInSafari?: boolean;
  variant?: InstallSheetVariant;
}

/**
 * Installing Reader, in the words and controls of this browser. Chromium
 * installs with one button; Safari takes a few taps in its own menus,
 * which the sheet shows as Safari draws them. The sheet stays open while
 * you use Safari's toolbar, so the steps stay in view between taps.
 */
export function InstallSheet({
  isOpen,
  onOpenChange,
  ...props
}: InstallSheetProps) {
  return (
    <DetentSheet isOpen={isOpen} onOpenChange={onOpenChange} title="Install">
      <InstallSheetBody {...props} onClose={() => onOpenChange(false)} />
    </DetentSheet>
  );
}

function InstallSheetBody({
  platform,
  traits,
  host,
  onInstall,
  booksStayInSafari = false,
  variant = "list",
  onClose,
}: Omit<InstallSheetProps, "isOpen" | "onOpenChange"> & {
  onClose: () => void;
}) {
  return (
    <div
      className="px-5 pt-1 pb-[max(env(safe-area-inset-bottom),1rem)]"
      data-install-sheet={platform}
      data-install-variant={variant}
    >
      <div className="flex items-center gap-3.5">
        <AppTile size={52} />
        <div className="min-w-0">
          <p className="font-serif text-[22px] leading-tight">Reader</p>
          <p className="truncate text-[13px] text-muted-foreground">{host}</p>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-snug text-muted-foreground">
        {installReason(platform, traits)}
      </p>
      {platform === "chromium" ? (
        <ChromiumInstall onInstall={onInstall} onClose={onClose} />
      ) : (
        <>
          {platform === "ios-safari" && (
            <SafariSteps variant={variant} traits={traits} host={host} />
          )}
          {platform === "ios-other" && <OpenInSafari host={host} />}
          {platform === "mac-safari" && (
            <p className="mt-4 text-[14px] leading-snug">
              In Safari’s menu bar, choose <b className="font-medium">File</b> →{" "}
              <b className="font-medium">Add to Dock</b>.
            </p>
          )}
          {booksStayInSafari && (
            <p className="mt-4 rounded-2xl bg-secondary px-3.5 py-2.5 text-[13px] leading-snug text-secondary-foreground dark:bg-foreground/[0.07]">
              The app keeps its own library. Sign in, here and in the app, to
              bring the books you added in Safari.
            </p>
          )}
          <Button
            variant="ghost"
            onClick={onClose}
            className="mt-3 h-11 w-full rounded-full text-[14px] text-muted-foreground"
          >
            Not now
          </Button>
        </>
      )}
    </div>
  );
}

function SafariSteps({
  variant,
  traits,
  host,
}: {
  variant: InstallSheetVariant;
  traits: BrowserTraits;
  host: string;
}) {
  const steps = safariSteps(traits);
  if (variant === "walkthrough")
    return (
      <SafariWalkthrough steps={steps} entry={shareEntry(traits)} host={host} />
    );
  if (variant === "sentence") return <StepSentence steps={steps} />;
  return <StepList steps={steps} />;
}

/** One row per tap: the control as Safari draws it, then what to do. */
function StepList({ steps }: { steps: SafariStep[] }) {
  return (
    <ol className="mt-4 flex flex-col" aria-label="Steps in Safari">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="flex min-h-11 items-center gap-3 border-b border-border/60 last:border-b-0"
        >
          <span className="w-3 shrink-0 text-right font-numeric text-[12px] text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="flex w-12 shrink-0 justify-center">{step.chip}</span>
          <span className="text-[14px] leading-snug [&_b]:font-medium">
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The taps as one sentence, each control inline beside its name. */
function StepSentence({ steps }: { steps: SafariStep[] }) {
  const last = steps.length - 1;
  return (
    <p className="mt-4 text-[15px] leading-[2.1]">
      {steps.map((step, index) => (
        <Fragment key={step.id}>
          {index === 0 ? "Tap " : index === last ? ", and " : ", "}
          <InlineChip>
            {/* Inline, the address bar's end reads as a stray shape. */}
            {step.id === "page-menu" ? (
              <SafariChip shape="round">
                <PageMenuGlyph className="size-4" />
              </SafariChip>
            ) : (
              step.chip
            )}
          </InlineChip>
          {step.id === "add" ? null : (
            <>
              {" "}
              <b className="font-medium">{step.name}</b>
            </>
          )}
        </Fragment>
      ))}
      .
    </p>
  );
}

function InlineChip({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex translate-y-[-1px] scale-90 align-middle">
      {children}
    </span>
  );
}

/**
 * The browser's own install dialog behind one button. Once installed, the
 * button turns into the confirmation in place, and the sheet closes.
 */
function ChromiumInstall({
  onInstall,
  onClose,
}: {
  onInstall: () => Promise<InstallOutcome>;
  onClose: () => void;
}) {
  const [state, setState] = useState<"idle" | "asking" | "installed">("idle");
  const install = async () => {
    setState("asking");
    const outcome = await onInstall();
    if (outcome !== "accepted") {
      onClose();
      return;
    }
    setState("installed");
    window.setTimeout(onClose, 1400);
  };
  return (
    <div className="mt-5 flex flex-col gap-1">
      <Button
        onClick={() => void install()}
        disabled={state !== "idle"}
        className={cn(
          "h-11 w-full rounded-full text-[15px] disabled:opacity-100",
          state === "asking" && "opacity-70",
        )}
      >
        {state === "installed" ? (
          <>
            <Check className="size-4" aria-hidden="true" />
            Installed
          </>
        ) : (
          "Install"
        )}
      </Button>
      {state !== "installed" && (
        <Button
          variant="ghost"
          onClick={onClose}
          className="h-11 w-full rounded-full text-[14px] text-muted-foreground"
        >
          Not now
        </Button>
      )}
    </div>
  );
}

/**
 * Another browser on iPhone or iPad. Safari installs Reader as an app;
 * Chrome and Edge can also add it from their Share menu.
 */
function OpenInSafari({ host }: { host: string }) {
  const [copied, setCopied] = useState(false);
  const url = `https://${host}/`;
  return (
    <div className="mt-4">
      <p className="text-[14px] leading-snug">
        Open <b className="font-medium">{host}</b> in Safari to install it.
        Chrome and Edge can add it too: <b className="font-medium">Share</b> →{" "}
        <b className="font-medium">Add to Home Screen</b>.
      </p>
      <Button
        variant="secondary"
        onClick={() =>
          void copyText(url).then((done) => {
            if (!done) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
        }
        className="mt-4 h-11 w-full rounded-full text-[14px]"
      >
        <CopyFeedbackIcon copied={copied} className="size-4" />
        {copied ? "Link copied" : "Copy link"}
      </Button>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SPRINGS, springTransition } from "@workbench/elements/spring";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import type { ShareEntry } from "./install-platform";
import type { SafariStep, SafariStepId } from "./install-steps";
import {
  AddToHomeGlyph,
  MoreGlyph,
  PageMenuGlyph,
  ReloadGlyph,
  ShareGlyph,
  SwitchOn,
  TabsGlyph,
  ViewMoreGlyph,
} from "./safari-glyphs";

/**
 * Safari's screens, one step at a time, at about half size. Each control
 * opens into the next screen the way Safari opens it: the menu grows out of
 * its button, the share sheet rises from the bottom edge, View More unfolds
 * in place, and Add to Home Screen rises over it. Back plays them in
 * reverse. The stage keeps one height, so the sheet holding it never moves.
 */
export function SafariWalkthrough({
  steps,
  entry,
  host,
}: {
  steps: SafariStep[];
  entry: ShareEntry;
  host: string;
}) {
  const [index, setIndex] = useState(0);
  const step = steps[index]!;
  const last = index === steps.length - 1;
  return (
    <div className="mt-4">
      <SafariStage at={step.id} entry={entry} host={host} />
      <div className="mt-3 flex min-h-11 items-center gap-3">
        <p
          className="min-w-0 flex-1 text-[14px] leading-snug [&_b]:font-medium"
          aria-live="polite"
        >
          <span className="sr-only">
            Step {index + 1} of {steps.length}:{" "}
          </span>
          {step.text}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
            className="rounded-full"
          >
            Back
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIndex(last ? 0 : index + 1)}
            className="min-w-16 rounded-full"
          >
            {last ? "Again" : "Next"}
          </Button>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
        {steps.map((item, dot) => (
          <span
            key={item.id}
            className={cn(
              "size-1.5 rounded-full transition-colors duration-150",
              dot === index ? "bg-foreground" : "bg-foreground/20",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The order of Safari's screens, to tell which layers are open. */
const ORDER: SafariStepId[] = [
  "page-menu",
  "more",
  "share",
  "view-more",
  "add-to-home",
  "add",
];

/** The highlighted control on each screen. */
function Target({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "relative inline-flex rounded-full transition-shadow duration-150",
        on &&
          "shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--foreground)]",
      )}
    >
      {children}
    </span>
  );
}

const ENTER = springTransition(SPRINGS.sheet);
const POP = springTransition(SPRINGS.snappy);

function SafariStage({
  at,
  entry,
  host,
}: {
  at: SafariStepId;
  entry: ShareEntry;
  host: string;
}) {
  const position = ORDER.indexOf(at);
  // Share opens from the Page Menu or ⋯; in the toolbar it is a button.
  const menuOpen = at === "share" && entry !== "toolbar";
  const shareSheetOpen = at === "view-more" || at === "add-to-home";
  const addSheetOpen = at === "add";
  const dimmed = position >= ORDER.indexOf("view-more");
  return (
    <div
      aria-hidden="true"
      className="relative h-[212px] overflow-hidden rounded-[22px] border border-border bg-background"
    >
      <MockPage />
      <motion.div
        className="absolute inset-0 bg-foreground"
        initial={false}
        animate={{ opacity: dimmed ? 0.12 : 0 }}
        transition={{ duration: 0.2 }}
      />
      <Toolbar at={at} entry={entry} host={host} />
      <AnimatePresence initial={false}>
        {menuOpen && (
          <motion.div
            key="menu"
            className={cn(
              "absolute bottom-[46px] w-[164px] rounded-[18px] border border-border/70 bg-background px-1.5 py-1.5 text-[11px] shadow-[0_8px_30px_color-mix(in_srgb,var(--foreground)_14%,transparent)]",
              entry === "page-menu"
                ? "left-[52px] origin-bottom-left"
                : "right-3 origin-bottom-right",
            )}
            initial={{ opacity: 0, scale: 0.2 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.2, transition: { duration: 0.14 } }}
            transition={POP}
          >
            <MenuRow icon={<span className="text-[9px]">文A</span>}>
              Translate Website…
            </MenuRow>
            <div className="mx-2 my-1 h-px bg-border" />
            <MenuRow icon={<ShareGlyph className="size-3.5" />} on>
              Share
            </MenuRow>
            <MenuRow
              icon={
                <span className="block h-3 w-2.5 rounded-[2px] border-[1.5px] border-current" />
              }
            >
              Add to Bookmarks
            </MenuRow>
            <MenuRow
              icon={
                <span className="block size-3 rounded-full border-[1.5px] border-current" />
              }
            >
              Find on Page
            </MenuRow>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {shareSheetOpen && (
          <motion.div
            key="share-sheet"
            className="absolute inset-x-2 top-4 bottom-0 overflow-hidden rounded-t-[24px] border border-b-0 border-border/70 bg-background shadow-[0_-8px_30px_color-mix(in_srgb,var(--foreground)_10%,transparent)]"
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%", transition: { duration: 0.18, ease: "easeIn" } }}
            transition={ENTER}
          >
            <ShareSheet expanded={at === "add-to-home"} host={host} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {addSheetOpen && (
          <motion.div
            key="add-sheet"
            className="absolute inset-x-0 top-2.5 bottom-0 overflow-hidden rounded-t-[24px] border border-b-0 border-border/70 bg-secondary dark:bg-[color-mix(in_srgb,var(--foreground)_6%,var(--background))]"
            initial={{ y: "105%" }}
            animate={{ y: 0 }}
            exit={{ y: "105%", transition: { duration: 0.18, ease: "easeIn" } }}
            transition={ENTER}
          >
            <AddSheet host={host} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The Library behind Safari's controls, in outline. */
function MockPage() {
  return (
    <div className="absolute inset-x-4 top-4 flex flex-col gap-3">
      <div className="h-2.5 w-16 rounded-full bg-foreground/15" />
      <div className="flex gap-3">
        {[0, 1, 2].map((cover) => (
          <div
            key={cover}
            className="h-[84px] w-[58px] rounded-[4px] bg-foreground/[0.07]"
          />
        ))}
      </div>
      <div className="h-2 w-24 rounded-full bg-foreground/10" />
    </div>
  );
}

/** Safari's bottom bar in the Compact layout: back, address, and Tabs or ⋯. */
function Toolbar({
  at,
  entry,
  host,
}: {
  at: SafariStepId;
  entry: ShareEntry;
  host: string;
}) {
  const circle =
    "grid size-[30px] shrink-0 place-items-center rounded-full border border-border/80 bg-background shadow-[0_1px_4px_color-mix(in_srgb,var(--foreground)_10%,transparent)]";
  return (
    <div className="absolute inset-x-3 bottom-2.5 flex items-center gap-1.5 text-foreground">
      <span className={cn(circle, "text-muted-foreground")}>
        <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
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
      <span className="flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-full border border-border/80 bg-background px-1 shadow-[0_1px_4px_color-mix(in_srgb,var(--foreground)_10%,transparent)]">
        {entry === "toolbar" ? (
          <span className="size-6" />
        ) : (
          <Target on={at === "page-menu"}>
            <span className="grid size-6 place-items-center rounded-full">
              <PageMenuGlyph className="size-3.5" />
            </span>
          </Target>
        )}
        <span className="min-w-0 flex-1 truncate text-center text-[11px]">
          {host}
        </span>
        <ReloadGlyph className="mr-1.5 size-3.5" />
      </span>
      {entry === "more" ? (
        <Target on={at === "more"}>
          <span className={circle}>
            <MoreGlyph className="size-3.5" />
          </span>
        </Target>
      ) : entry === "toolbar" ? (
        <Target on={at === "share"}>
          <span className={circle}>
            <ShareGlyph className="size-3.5" />
          </span>
        </Target>
      ) : (
        <span className={circle}>
          <TabsGlyph className="size-3.5" />
        </span>
      )}
    </div>
  );
}

function MenuRow({
  icon,
  on = false,
  children,
}: {
  icon: ReactNode;
  on?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-[22px] items-center gap-2 rounded-full px-2",
        on && "bg-foreground text-background",
      )}
    >
      <span className="grid w-4 place-items-center">{icon}</span>
      {children}
    </div>
  );
}

/** Safari's share sheet: the page, the round actions, and View More's list. */
function ShareSheet({ expanded, host }: { expanded: boolean; host: string }) {
  return (
    <motion.div
      className="px-3 pt-3"
      initial={false}
      // The list unfolds below the actions; the sheet shows its end.
      animate={{ y: expanded ? -78 : 0 }}
      transition={ENTER}
    >
      <div className="flex items-center gap-2.5">
        <AppTile size={30} />
        <div className="min-w-0 leading-tight">
          <div className="text-[11px] font-semibold">Reader</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {host}
          </div>
        </div>
      </div>
      <div className="my-2.5 h-px bg-border" />
      <div className="grid grid-cols-4 gap-1 text-center text-[9px] leading-tight text-foreground">
        <RoundAction label="Copy">
          <span className="block h-3 w-2.5 rounded-[2px] border-[1.5px] border-current" />
        </RoundAction>
        <RoundAction label="Add to Bookmarks">
          <span className="block h-3 w-2.5 rounded-[2px] border-[1.5px] border-current" />
        </RoundAction>
        <RoundAction label="Add to Reading List">
          <span className="block h-1.5 w-3.5 rounded-full border-[1.5px] border-current" />
        </RoundAction>
        <RoundAction
          label={expanded ? "View Less" : "View More"}
          on={!expanded}
        >
          <ViewMoreGlyph
            className={cn(
              "size-3.5 transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </RoundAction>
      </div>
      <motion.div
        className="mt-3 overflow-hidden rounded-[14px] bg-secondary text-[11px] dark:bg-foreground/[0.07]"
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: 0.18 }}
      >
        {["Add Bookmark to…", "Add to Favourites", "Find on Page"].map(
          (label) => (
            <div
              key={label}
              className="flex h-[26px] items-center gap-2 border-b border-border/70 px-3"
            >
              <span className="size-3 rounded-[3px] border-[1.5px] border-current opacity-70" />
              {label}
            </div>
          ),
        )}
        <div className="flex h-[30px] items-center gap-2 px-1.5">
          <Target on={expanded}>
            <span className="flex h-[24px] items-center gap-2 rounded-full px-1.5">
              <AddToHomeGlyph className="size-3.5" />
              Add to Home Screen
            </span>
          </Target>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RoundAction({
  label,
  on = false,
  children,
}: {
  label: string;
  on?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Target on={on}>
        <span className="grid size-[30px] place-items-center rounded-full bg-secondary dark:bg-foreground/10">
          {children}
        </span>
      </Target>
      <span className="line-clamp-2">{label}</span>
    </div>
  );
}

/** Safari's Add to Home Screen sheet, with Open as Web App on. */
function AddSheet({ host }: { host: string }) {
  return (
    <div className="px-3 pt-2.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="grid size-[26px] place-items-center rounded-full border border-border bg-background text-[12px] text-muted-foreground">
          ×
        </span>
        <span className="font-semibold">Add to Home Screen</span>
        <Target on>
          <span className="flex h-[26px] items-center rounded-full bg-primary px-3 font-semibold text-primary-foreground">
            Add
          </span>
        </Target>
      </div>
      <div className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-background px-2.5 py-2">
        <AppTile size={30} />
        <div className="min-w-0 flex-1 leading-tight">
          <div>Reader</div>
          <div className="truncate text-[10px] text-muted-foreground">
            https://{host}/
          </div>
        </div>
      </div>
      <div className="mt-2 flex h-[34px] items-center justify-between rounded-[12px] bg-background px-2.5">
        Open as Web App
        <SwitchOn />
      </div>
    </div>
  );
}

/** Reader's Home Screen icon. */
export function AppTile({ size }: { size: number }) {
  return (
    <img
      src="/apple-touch-icon-180x180.png"
      alt=""
      width={size}
      height={size}
      className="image-outline shrink-0 rounded-[22%]"
      style={{ width: size, height: size }}
    />
  );
}

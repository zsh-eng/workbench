/**
 * How you move between the library and highlights. Two variants to compare:
 * - sidebar: a sidebar that stays in the library and floats while reading.
 * - header: no sidebar. The page titles are the navigation.
 */
import { cn } from "@/lib/utils";
import { Keyboard, Moon, PanelLeft, Sun } from "lucide-react";
import { useState } from "react";
import { IconButton, Popover } from "./ui";

export type SystemNav = "sidebar" | "header";

export type SystemView =
  | { kind: "library" }
  | { kind: "highlights" }
  | { kind: "reader"; bookId: string };

type Place = Exclude<SystemView["kind"], "reader">;

const PLACES: { kind: Place; label: string }[] = [
  { kind: "library", label: "Library" },
  { kind: "highlights", label: "Highlights" },
];

const TITLE = "xp-serif leading-none tracking-[-0.01em]";

/**
 * The page title. With header navigation both places show, and the one you
 * are on is darker. With a sidebar, a phone gets a button to open it.
 */
export function PageTitle({
  nav,
  current,
  narrow,
  onNavigate,
  onShowSidebar,
}: {
  nav: SystemNav;
  current: Place;
  narrow: boolean;
  onNavigate: (view: SystemView) => void;
  onShowSidebar: () => void;
}) {
  if (nav === "header") {
    return (
      <nav aria-label="Sections" className="flex min-w-0 items-baseline gap-4">
        {PLACES.map((place) => {
          const active = place.kind === current;
          return (
            <button
              key={place.kind}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate({ kind: place.kind })}
              className={cn(
                TITLE,
                narrow ? "text-[26px]" : "text-[30px]",
                "cursor-pointer rounded-sm whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "text-foreground"
                  : "text-foreground/30 hover:text-foreground/55",
              )}
            >
              {place.label}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {narrow && (
        <IconButton
          label="Show sidebar"
          onClick={onShowSidebar}
          className="-ml-2"
        >
          <PanelLeft className="size-4" strokeWidth={1.6} />
        </IconButton>
      )}
      <h1 className={cn(TITLE, "text-[30px]")}>
        {PLACES.find((place) => place.kind === current)?.label}
      </h1>
    </div>
  );
}

export function ShortcutsButton({
  sidebar,
  side = "top",
}: {
  /** Whether the sidebar shortcut applies. */
  sidebar: boolean;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconButton
        label="Keyboard shortcuts"
        active={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Keyboard className="size-[15px]" strokeWidth={1.7} />
      </IconButton>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        side={side}
        align="end"
        className="w-56 p-1.5"
      >
        <ShortcutRow label="Search" keys="/" />
        <ShortcutRow label="Go to anything" keys="⌘K" />
        <ShortcutRow label="Turn the page" keys="← →" />
        <ShortcutRow label="Contents" keys="T" />
        <ShortcutRow label="Notes" keys="N" />
        <ShortcutRow label="Appearance" keys="A" />
        <ShortcutRow label="Bookmark" keys="B" />
        {sidebar && <ShortcutRow label="Sidebar while reading" keys="[" />}
        <ShortcutRow label="Close" keys="Esc" />
      </Popover>
    </div>
  );
}

export function ThemeButton({
  isDark,
  onToggle,
}: {
  isDark: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      label={isDark ? "Light appearance" : "Dark appearance"}
      onClick={onToggle}
    >
      {isDark ? (
        <Sun className="size-[15px]" strokeWidth={1.7} />
      ) : (
        <Moon className="size-[15px]" strokeWidth={1.7} />
      )}
    </IconButton>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex h-7 items-center justify-between gap-3 px-2 text-[12.5px]">
      <span className="text-foreground/80">{label}</span>
      <span className="font-sans text-[12px] text-muted-foreground">
        {keys}
      </span>
    </div>
  );
}

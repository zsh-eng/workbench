/**
 * The app sidebar: two places. In the library it is part of the screen and
 * stays; while reading it floats. Search lives in each page, and the books
 * you are reading live once, on the library's shelf.
 */
import { cn } from "@/lib/utils";
import { Highlighter, LibraryBig } from "lucide-react";
import type { ReactNode } from "react";
import { ShortcutsButton, ThemeButton, type SystemView } from "./Navigation";

export function Sidebar({
  view,
  isDark,
  onNavigate,
  onToggleTheme,
}: {
  view: SystemView;
  isDark: boolean;
  onNavigate: (view: SystemView) => void;
  onToggleTheme: () => void;
}) {
  return (
    <div className="flex h-full flex-col p-3">
      <nav aria-label="Sections" className="space-y-px">
        <NavItem
          icon={<LibraryBig className="size-[15px]" strokeWidth={1.7} />}
          label="Library"
          active={view.kind === "library"}
          onClick={() => onNavigate({ kind: "library" })}
        />
        <NavItem
          icon={<Highlighter className="size-[15px]" strokeWidth={1.7} />}
          label="Highlights"
          active={view.kind === "highlights"}
          onClick={() => onNavigate({ kind: "highlights" })}
        />
      </nav>

      <div className="mt-auto flex items-center justify-end gap-0.5 pt-3">
        <ShortcutsButton sidebar />
        <ThemeButton isDark={isDark} onToggle={onToggleTheme} />
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-foreground/[0.05] text-foreground"
          : "text-foreground/75 hover:bg-foreground/[0.035] hover:text-foreground",
      )}
    >
      <span className={active ? "text-foreground" : "text-muted-foreground"}>
        {icon}
      </span>
      {label}
    </button>
  );
}

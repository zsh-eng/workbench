import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { TOCItem } from "@/lib/db";
import { cn } from "@/lib/utils";
import type { ReaderSettings } from "@/types/reader.types";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  PanelRight,
  ClipboardCopy,
  NotebookPen,
  List,
  Search,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { ReaderContentsPanel } from "./ReaderContentsSheet";
import { ReaderSettingsList } from "./ReaderSettingsSheet";
import type { ChapterEntry, ReaderSheetId } from "./types";
import { MOTION_MS } from "@/lib/motion";

type ReaderSidebarPanel = "contents" | "search" | "settings" | "notes";

interface ReaderToolsSidebarProps {
  activeSheet: ReaderSheetId | null;
  onOpenPanel: (panel: ReaderSheetId) => void;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  onNavigateToHref: (href: string) => boolean;
  notesPanel?: ReactNode;
  onCopyDebugDump?: () => void;
}

const SIDEBAR_TOOLS: {
  id: ReaderSidebarPanel;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "contents", label: "Contents", icon: List },
  { id: "search", label: "Search book", icon: Search },
  { id: "settings", label: "Reading appearance", icon: Palette },
  { id: "notes", label: "Notebook", icon: NotebookPen },
];

function resolveActivePanel(
  activeSheet: ReaderSheetId | null,
): ReaderSidebarPanel {
  if (activeSheet === "notes") return "notes";
  if (activeSheet === "search") return "search";
  if (activeSheet === "settings") return "settings";
  return "contents";
}

/**
 * Desktop reader workspace anchored to the book's right edge.
 *
 * Frequent tools switch within one persistent surface. This keeps the book in
 * view and avoids a stack of launcher and destination sheets.
 */
export function ReaderToolsSidebar({
  activeSheet,
  onOpenPanel,
  onClose,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  onNavigateToHref,
  onCopyDebugDump,
  notesPanel,
}: ReaderToolsSidebarProps) {
  // Closing changes visibility, not the content shown during the exit.
  const [retainedPanel, setRetainedPanel] = useState(() =>
    resolveActivePanel(activeSheet),
  );
  const activePanel =
    activeSheet === null ? retainedPanel : resolveActivePanel(activeSheet);
  if (activePanel !== retainedPanel) setRetainedPanel(activePanel);
  const isOpen = activeSheet !== null;

  useHotkey(
    { key: "\\", mod: true, shift: true },
    (event) => {
      event.preventDefault();
      if (isOpen) {
        onClose();
        return;
      }

      onOpenPanel("tools");
    },
    {
      target: window,
      ignoreInputs: false,
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: "Toggle reader tools",
        description: "Show or hide the reader tools sidebar",
      },
    },
  );

  return (
    <aside
      aria-label="Reader tools"
      aria-hidden={!isOpen}
      inert={!isOpen ? true : undefined}
      className="pointer-events-none fixed inset-0 z-40 hidden text-foreground md:block"
    >
      <button
        type="button"
        aria-label="Close reader tools"
        aria-hidden={!isOpen}
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-transparent",
          isOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      />

      <div
        className={cn(
          "pointer-events-auto fixed inset-y-3 right-3 z-50 flex min-w-[20rem] w-[min(42vw,25rem)] transition-[opacity,transform,scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none",
          isOpen
            ? "[transform:translate3d(0,0,0)] opacity-100"
            : "pointer-events-none [transform:translate3d(12px,0,0)] opacity-0",
        )}
        style={{
          transitionDuration: `${isOpen ? MOTION_MS.enter : MOTION_MS.exit}ms`,
        }}
      >
        <div
          data-slot="reader-tools-surface"
          className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-(--sidebar-panel-radius) border border-border/70 bg-background/95 text-foreground shadow-[-24px_0_64px_color-mix(in_srgb,var(--foreground)_12%,transparent)] backdrop-blur-2xl select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]"
        >
          <nav
            aria-label="Reader tools"
            className="relative z-10 flex min-h-14 shrink-0 items-start gap-1.5 pl-3 pr-(--sidebar-panel-content-inset) pb-2"
            style={{
              paddingTop:
                "max(env(safe-area-inset-top), var(--sidebar-panel-content-inset))",
            }}
          >
            {SIDEBAR_TOOLS.map((tool) => {
              const isActive = activePanel === tool.id;

              return (
                <Button
                  key={tool.id}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenPanel(tool.id)}
                  aria-label={tool.label}
                  aria-pressed={isActive}
                  title={tool.label}
                  className={cn(
                    "size-9 shrink-0 rounded-xl first:rounded-tl-(--sidebar-panel-field-radius) text-muted-foreground transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95",
                    isActive && "bg-secondary/70 text-foreground shadow-sm",
                  )}
                >
                  <tool.icon className="size-[1.15rem]" />
                </Button>
              );
            })}

            <div className="min-w-0 flex-1" />

            {onCopyDebugDump && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCopyDebugDump}
                aria-label="Copy debug dump"
                title="Copy debug dump"
                className="size-9 shrink-0 rounded-xl text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95"
              >
                <ClipboardCopy className="size-[1.1rem]" />
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close reader tools"
              aria-pressed={isOpen}
              className="size-9 shrink-0 rounded-xl rounded-tr-(--sidebar-panel-field-radius) text-muted-foreground transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95 aria-pressed:bg-secondary/70 aria-pressed:text-foreground"
            >
              <PanelRight className="size-[1.15rem]" />
            </Button>

            {activePanel !== "settings" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background/80 to-transparent"
              />
            )}
          </nav>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activePanel === "notes" && notesPanel}
            {activePanel === "contents" && (
              <ReaderContentsPanel
                isOpen={isOpen}
                toc={toc}
                chapterEntries={chapterEntries}
                chapterStartPages={chapterStartPages}
                currentChapterHref={currentChapterHref}
                onNavigateToHref={onNavigateToHref}
                className="h-full"
              />
            )}

            {activePanel === "search" && (
              <div className="flex h-full flex-col items-center justify-center px-8 pb-[env(safe-area-inset-bottom)] text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-secondary/45 text-muted-foreground">
                  <Search className="size-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">
                  Search is coming soon
                </p>
                <p className="mt-1 max-w-56 text-sm leading-relaxed text-muted-foreground">
                  Full-book search needs a text index before it can return
                  accurate results.
                </p>
              </div>
            )}

            {activePanel === "settings" && (
              <ReaderSettingsList
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                className="pb-[env(safe-area-inset-bottom)]"
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

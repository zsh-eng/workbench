import { SettingsGroup } from "@/components/appearance/settings-layout";
import { cn } from "@/lib/utils";
import {
  BookMarked,
  ClipboardCopy,
  List,
  NotebookPen,
  Palette,
  Search,
  type LucideIcon,
} from "lucide-react";

interface ReaderControlMenuProps {
  onOpenContents: () => void;
  onOpenBookActions: () => void;
  onOpenSettings: () => void;
  onOpenNotes?: () => void;
  onOpenSearch?: () => void;
  onCopyDebugDump?: () => void;
}

interface Tool {
  label: string;
  icon: LucideIcon;
  onClick: (() => void) | undefined;
}

function ToolRow({ tool }: { tool: Tool }) {
  return (
    <button
      type="button"
      disabled={!tool.onClick}
      onClick={tool.onClick}
      className={cn(
        "-mx-3.5 flex min-h-12 w-[calc(100%+1.75rem)] items-center justify-between gap-3 px-3.5 text-left text-[15px] text-foreground outline-none transition-colors duration-150 first:rounded-t-[14px] last:rounded-b-[14px] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        tool.onClick
          ? "hover:bg-foreground/[0.04] active:bg-foreground/[0.07]"
          : "cursor-not-allowed opacity-55",
      )}
    >
      <span className="min-w-0 truncate">{tool.label}</span>
      <tool.icon
        className="size-[18px] shrink-0 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </button>
  );
}

/**
 * The phone's Reader tools: one list of what you can open, in the rows
 * that Appearance and Settings use, and the Debug dump apart from it.
 */
export function ReaderControlMenu({
  onOpenContents,
  onOpenBookActions,
  onOpenSettings,
  onOpenNotes,
  onOpenSearch,
  onCopyDebugDump,
}: ReaderControlMenuProps) {
  const tools: Tool[] = [
    { label: "Contents", icon: List, onClick: onOpenContents },
    { label: "Search book", icon: Search, onClick: onOpenSearch },
    { label: "Notebook", icon: NotebookPen, onClick: onOpenNotes },
    { label: "Appearance", icon: Palette, onClick: onOpenSettings },
    { label: "Reading status", icon: BookMarked, onClick: onOpenBookActions },
  ];
  return (
    <div
      className="space-y-3 px-4 pt-2"
      style={{ paddingBottom: `calc(1rem + env(safe-area-inset-bottom))` }}
    >
      <SettingsGroup compact>
        {tools.map((tool) => (
          <ToolRow key={tool.label} tool={tool} />
        ))}
      </SettingsGroup>
      {onCopyDebugDump && (
        <SettingsGroup compact>
          <ToolRow
            tool={{
              label: "Copy debug dump",
              icon: ClipboardCopy,
              onClick: onCopyDebugDump,
            }}
          />
        </SettingsGroup>
      )}
    </div>
  );
}

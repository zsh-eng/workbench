import { SheetUtilityButton } from "@/components/SheetUtilityButton";
import { cn } from "@/lib/utils";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import {
  BookMarked,
  ClipboardCopy,
  List,
  NotebookPen,
  Search,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";

interface ReaderControlMenuProps {
  onOpenContents: () => void;
  onOpenBookActions: () => void;
  onOpenSettings: () => void;
  onOpenNotes?: () => void;
  onCopyDebugDump?: () => void;
}

type MenuItemId = "contents" | "book-actions" | "search" | "debug-dump";

interface MenuItem {
  id: MenuItemId;
  label: string;
  icon: LucideIcon;
  isAvailable: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "contents", label: "Contents", icon: List, isAvailable: true },
  {
    id: "book-actions",
    label: "Book status",
    icon: BookMarked,
    isAvailable: true,
  },
  { id: "search", label: "Search book", icon: Search, isAvailable: false },
  {
    id: "debug-dump",
    label: "Copy Debug Dump",
    icon: ClipboardCopy,
    isAvailable: true,
  },
];

function ReaderControlMenuItem({
  item,
  index,
  disabled,
  onClick,
}: {
  item: MenuItem;
  index: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const springPress = useSpringPressAnimation();

  return (
    <div>
      <motion.button
        type="button"
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left transition-colors",
          disabled ? "cursor-not-allowed opacity-60" : "hover:bg-secondary/55",
        )}
        onClick={onClick}
        {...springPress}
      >
        <div className="min-w-0">
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="mt-1 block truncate text-sm font-medium text-foreground">
            {item.label}
          </span>
        </div>
        <item.icon className="size-4 text-muted-foreground" />
      </motion.button>
    </div>
  );
}

export function ReaderControlMenu({
  onOpenContents,
  onOpenBookActions,
  onOpenSettings,
  onOpenNotes,
  onCopyDebugDump,
}: ReaderControlMenuProps) {
  const handleRowClick = (id: MenuItemId) => {
    if (id === "contents") {
      onOpenContents();
      return;
    }

    if (id === "book-actions") {
      onOpenBookActions();
      return;
    }

    if (id === "debug-dump") {
      onCopyDebugDump?.();
    }
  };

  return (
    <div
      className="px-4 py-3"
      style={{
        paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
      }}
    >
      <div className="flex flex-col gap-2">
        {MENU_ITEMS.filter(
          (item) => item.id !== "debug-dump" || onCopyDebugDump,
        ).map((item, index) => {
          const isDisabled =
            !item.isAvailable || (item.id === "debug-dump" && !onCopyDebugDump);

          return (
            <ReaderControlMenuItem
              key={item.id}
              item={item}
              index={index}
              disabled={isDisabled}
              onClick={() => handleRowClick(item.id)}
            />
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-[1.25rem] border border-border/60 bg-secondary/20">
        <SheetUtilityButton
          label="Theme"
          accessibleLabel="Themes & settings"
          onClick={onOpenSettings}
        >
          <Palette className="size-5" aria-hidden="true" />
        </SheetUtilityButton>
        <SheetUtilityButton
          label="Notebook"
          onClick={onOpenNotes}
          disabled={!onOpenNotes}
          className="border-l border-border/60"
        >
          <NotebookPen className="size-5" aria-hidden="true" />
        </SheetUtilityButton>
      </div>
    </div>
  );
}

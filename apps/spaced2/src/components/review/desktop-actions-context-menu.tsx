import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { dropdownMenuItemVariants } from "@/components/ui/dropdown-variants";
import { cn } from "@/lib/utils";
import { useCompactWindow } from "@/components/hooks/use-compact-window";
import { Ban, BookmarkIcon, ChevronsRight, Pencil, Trash } from "lucide-react";

type DesktopActionsContextMenuProps = {
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  bookmarked: boolean;
  handleBookmark: (bookmarked: boolean) => void;
  handleDelete: () => void;
  handleSkip: () => void;
  handleBury: () => void;
  handleEdit: () => void;
};

export default function DesktopActionsContextMenu({
  onOpenChange,
  bookmarked,
  handleBookmark,
  handleDelete,
  handleSkip,
  handleBury,
  handleEdit,
  children,
}: DesktopActionsContextMenuProps) {
  const isMobile = useCompactWindow();
  return (
    <ContextMenu modal={false} onOpenChange={onOpenChange}>
      <ContextMenuTrigger
        onContextMenu={(e) => {
          if (isMobile) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        asChild
      >
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56 sm:w-40 text-muted-foreground text-base sm:text-sm bg-muted/80 backdrop-blur-xl rounded-lg p-1 flex flex-col shadow-sm mt-3 mr-8 animate-fade-in-dropdown-menu gap-1">
        <ContextMenuItem
          className={dropdownMenuItemVariants({ variant: "telegram" })}
          onClick={() => handleBookmark(!bookmarked)}
        >
          <BookmarkIcon
            className={cn(
              "size-5 group-hover:animate-wobble-icon",
              bookmarked && "text-primary",
            )}
            fill={bookmarked ? "currentColor" : "none"}
          />
          <p className="text-base sm:text-sm">
            {bookmarked ? "Unsave" : "Save"}
          </p>
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-muted-foreground/10 mx-0 my-0" />

        <ContextMenuGroup className="flex flex-col gap-0">
          <ContextMenuItem
            className={dropdownMenuItemVariants({ variant: "telegram" })}
            onClick={handleSkip}
          >
            <ChevronsRight className="size-5 group-hover:animate-scale-arrow-icon-size" />
            <p className="text-base sm:text-sm">Skip</p>
          </ContextMenuItem>

          <ContextMenuItem
            className={dropdownMenuItemVariants({ variant: "telegram" })}
            onClick={handleBury}
          >
            <Ban className="size-5 group-hover:animate-scale-icon-size" />
            <p className="text-base sm:text-sm">Bury</p>
          </ContextMenuItem>
        </ContextMenuGroup>

        <ContextMenuSeparator className="bg-muted-foreground/10 mx-0 my-0" />

        <ContextMenuGroup className="flex flex-col gap-0">
          <ContextMenuItem
            className={dropdownMenuItemVariants({ variant: "telegram" })}
            onClick={handleEdit}
          >
            <Pencil className="size-5 group-hover:animate-move-pencil-icon" />
            <p className="text-base sm:text-sm">Edit</p>
          </ContextMenuItem>

          <ContextMenuItem
            className={dropdownMenuItemVariants({ variant: "telegram" })}
            onClick={handleDelete}
          >
            <Trash className="size-5 group-hover:animate-bounce-trash-icon" />
            <p className="text-base sm:text-sm">Delete</p>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

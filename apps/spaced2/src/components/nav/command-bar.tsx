import { useReviewActionTarget } from "@/components/hooks/use-review-action-target";
import EditFlashcardResponsive from "@/components/card-actions/edit-flashcard-responsive";
import { useCards, useDecks, useCurrentCard } from "@/components/hooks/query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { CardContentFormValues } from "@/lib/form-schema";
import {
  handleCardBury,
  handleCardDelete,
  handleCardEdit,
  handleCardSave,
  handleCardSuspend,
} from "@/lib/review/actions";
import { imagesActivity } from "@/lib/images/images-activity";
import { Deck } from "@/lib/types";
import {
  Ban,
  Book,
  Bookmark,
  BookmarkIcon,
  ChevronsRight,
  Home,
  ImageDown,
  Pencil,
  Plus,
  Trash,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

function NavPathCommandItem({
  path,
  icon,
  label,
  onSelect,
}: {
  path: string;
  icon: React.ReactNode;
  label: string;
  onSelect: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <CommandItem
      onSelect={() => {
        navigate(path);
        onSelect();
      }}
    >
      {icon}
      <span>{label}</span>
      {location.pathname === path && (
        <CommandShortcut className="uppercase tracking-wide font-semibold text-xs text-muted-foreground/50">
          Current
        </CommandShortcut>
      )}
    </CommandItem>
  );
}

type CommandBarActionsProps = {
  bookmarked: boolean;
  handleBookmark: (bookmarked: boolean) => void;
  handleDelete: () => void;
  handleSkip: () => void;
  handleBury: () => void;
  handleEdit: () => void;
};

function CommandBarActions({
  bookmarked,
  handleBookmark,
  handleDelete,
  handleSkip,
  handleBury,
  handleEdit,
}: CommandBarActionsProps) {
  return (
    <>
      <CommandItem onSelect={() => handleBookmark(!bookmarked)}>
        <BookmarkIcon className={bookmarked ? "text-primary" : ""} />
        <span>{bookmarked ? "Unsave" : "Save"}</span>
      </CommandItem>

      <CommandItem onSelect={handleSkip}>
        <ChevronsRight />
        <span>Skip</span>
      </CommandItem>

      <CommandItem onSelect={handleBury}>
        <Ban />
        <span>Bury</span>
      </CommandItem>

      <CommandItem onSelect={handleEdit}>
        <Pencil />
        <span>Edit</span>
      </CommandItem>

      <CommandItem onSelect={handleDelete}>
        <Trash />
        <span>Delete</span>
      </CommandItem>
    </>
  );
}

function CommandBarDecks({
  decks,
  onSelect,
}: {
  decks: Deck[];
  onSelect: (deckId: string) => void;
}) {
  return (
    <CommandGroup heading="Decks">
      {decks.map((deck) => (
        <CommandItem key={deck.id} onSelect={() => onSelect(deck.id)}>
          <Book className="h-4 w-4 text-primary" />
          {deck.name}
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
export default function CommandBar() {
  const [open, setOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const { pathname } = useLocation();
  const isReviewPath = pathname === "/";

  const decks = useDecks();
  const navigate = useNavigate();
  const nextReviewCard = useCurrentCard();

  const { target, capture, getTarget } = useReviewActionTarget(
    useCards(),
    nextReviewCard,
  );
  const changeOpen = (value: boolean) => {
    if (value) capture();
    setOpen(value);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        changeOpen(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  });

  function handleDeckSelect(deckId: string) {
    navigate(`/decks/${deckId}`);
    setOpen(false);
  }

  async function handleDelete() {
    await handleCardDelete(getTarget());
    setOpen(false);
  }

  async function handleSuspend() {
    await handleCardSuspend(getTarget());
    setOpen(false);
  }

  async function handleBury() {
    await handleCardBury(getTarget());
    setOpen(false);
  }

  async function handleSave(bookmarked: boolean) {
    await handleCardSave(bookmarked, getTarget());
    setOpen(false);
  }

  async function handleEdit(values: CardContentFormValues) {
    await handleCardEdit(values, getTarget(true));
    setIsEditing(false);
  }

  return (
    <>
      {/* Cannot nest in the dialog, must be separate such that we can open and close individually */}
      {isReviewPath && target && (
        <EditFlashcardResponsive
          card={target}
          open={isEditing}
          onOpenChange={setIsEditing}
          onEdit={handleEdit}
          actions={{
            bookmarked: target.bookmarked,
            onBookmark: handleSave,
            onDelete: handleDelete,
            onBury: handleBury,
          }}
        />
      )}

      <CommandDialog open={open} onOpenChange={changeOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {isReviewPath && target && (
            <CommandGroup heading="Actions">
              <CommandBarActions
                bookmarked={target.bookmarked}
                handleBookmark={handleSave}
                handleDelete={handleDelete}
                handleSkip={handleSuspend}
                handleBury={handleBury}
                handleEdit={async () => {
                  // Close command par before opening the edit dialog
                  setOpen(false);
                  setIsEditing(true);
                }}
              />
            </CommandGroup>
          )}

          <CommandGroup heading="Navigation">
            <NavPathCommandItem
              path="/"
              icon={<Home className="h-4 w-4" />}
              label="Home"
              onSelect={() => setOpen(false)}
            />
            <NavPathCommandItem
              path="/decks"
              icon={<Book className="h-4 w-4" />}
              label="Decks"
              onSelect={() => setOpen(false)}
            />
            <NavPathCommandItem
              path="/saved"
              icon={<Bookmark className="h-4 w-4" />}
              label="Saved"
              onSelect={() => setOpen(false)}
            />
            <NavPathCommandItem
              path="/create"
              icon={<Plus className="h-4 w-4" />}
              label="Create"
              onSelect={() => setOpen(false)}
            />
            <NavPathCommandItem
              path="/profile"
              icon={<UserRound className="h-4 w-4" />}
              label="Profile"
              onSelect={() => setOpen(false)}
            />
            <NavPathCommandItem
              path="/import"
              icon={<Upload className="h-4 w-4" />}
              label="Import"
              onSelect={() => setOpen(false)}
            />
          </CommandGroup>

          <CommandGroup heading="Offline">
            <CommandItem
              onSelect={() => {
                imagesActivity.start();
                setOpen(false);
              }}
            >
              <ImageDown className="h-4 w-4" />
              <span>Download all images</span>
            </CommandItem>
          </CommandGroup>

          <CommandBarDecks decks={decks} onSelect={handleDeckSelect} />
        </CommandList>
      </CommandDialog>
    </>
  );
}

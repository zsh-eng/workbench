import { Tooltip } from "@base-ui/react/tooltip";
import { Select } from "@base-ui/react/select";
import { Dialog } from "@base-ui/react/dialog";
import {
  Check,
  ChevronDown,
  Archive,
  ArchiveRestore,
  Bookmark,
  BookmarkCheck,
  Star,
  Link2,
  ExternalLink,
  Tags,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Article } from "./model";
import { changeLibrary } from "./store";
export function Tool({
  label,
  children,
  onClick,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            className={`tool ${active ? "active" : ""}`}
            aria-label={label}
            aria-pressed={active}
            onClick={onClick}
          >
            {children}
          </button>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner
          side="top"
          sideOffset={8}
          className="tooltip-position"
        >
          <Tooltip.Popup className="tooltip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function Modal({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="backdrop" />
        <Dialog.Popup className="dialog">
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="tool" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ArticleActions({
  article,
  notify,
}: {
  article: Article;
  notify: (message: string) => void;
}) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tags, setTags] = useState("");
  const update = async (patch: Partial<Article>, message: string) => {
    try {
      await changeLibrary((library) => ({
        ...library,
        articles: library.articles.map((a) =>
          a.id === article.id ? { ...a, ...patch } : a,
        ),
      }));
      notify(message);
    } catch {
      notify("Could not save this change. Please try again.");
    }
  };
  return (
    <>
      <div className="actions" aria-label={`Actions for ${article.title}`}>
        <Tool
          label={article.saved ? "Unsave article" : "Save article"}
          active={article.saved}
          onClick={() =>
            void update(
              {
                saved: !article.saved,
                ...(article.saved ? { favourite: false } : {}),
              },
              article.saved
                ? "Article unsaved. Find it in All articles."
                : "Article saved.",
            )
          }
        >
          {article.saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
        </Tool>
        <Tool
          label={article.favourite ? "Remove favourite" : "Favourite article"}
          active={article.favourite}
          onClick={() =>
            void update(
              { favourite: !article.favourite, saved: true },
              article.favourite ? "Favourite removed." : "Added to favourites.",
            )
          }
        >
          <Star size={17} />
        </Tool>
        <Tool
          label={article.archived ? "Restore article" : "Archive article"}
          onClick={() =>
            void update(
              { archived: !article.archived },
              article.archived
                ? "Article restored."
                : "Article moved to Archive.",
            )
          }
        >
          {article.archived ? (
            <ArchiveRestore size={17} />
          ) : (
            <Archive size={17} />
          )}
        </Tool>
        <Tool
          label="Edit tags"
          onClick={() => {
            setTags(article.tags.join(", "));
            setTagsOpen(true);
          }}
        >
          <Tags size={17} />
        </Tool>
        <Tool
          label="Copy source link"
          onClick={() => {
            void navigator.clipboard.writeText(article.url).then(
              () => notify("Source link copied."),
              () => notify("Could not copy. Use Open original."),
            );
          }}
        >
          <Link2 size={17} />
        </Tool>
        <a
          className="tool"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open original"
          title="Open original"
        >
          <ExternalLink size={17} />
        </a>
      </div>
      <Modal
        title="Edit article tags"
        open={tagsOpen}
        onOpenChange={setTagsOpen}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void update(
              {
                tags: [
                  ...new Set(
                    tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  ),
                ],
              },
              "Tags updated.",
            ).then(() => setTagsOpen(false));
          }}
        >
          <label htmlFor={`tags-${article.id}`}>
            Tags, separated by commas
          </label>
          <input
            id={`tags-${article.id}`}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            autoFocus
          />
          <button className="primary" type="submit">
            Save tags
          </button>
        </form>
      </Modal>
    </>
  );
}

const sortOptions = [
  { value: "reading", label: "Reading order" },
  { value: "newest", label: "Newest first" },
  { value: "title", label: "Title A–Z" },
];
export function SortSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select.Root
      items={sortOptions}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <Select.Trigger className="sort" aria-label="Sort articles">
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={13} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="select-position"
          sideOffset={6}
          align="end"
          alignItemWithTrigger={false}
        >
          <Select.Popup className="select-popup">
            <Select.List>
              {sortOptions.map((option) => (
                <Select.Item
                  className="select-item"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-check">
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

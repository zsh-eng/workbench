import { Menu } from "@base-ui/react/menu";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BookmarkPlus,
  Clock,
  Highlighter,
  FileText,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  LogOut,
  RefreshCw,
  Settings,
  Share,
  Star,
  Trash2,
} from "lucide-react";
import {
  cloneElement,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "./api";
import { edits, editLibrary, removeArticle, type Article } from "./articles";
import {
  dismissToast,
  holdToast,
  reportError,
  showToast,
  useSession,
  useStatus,
  useToast,
} from "./state";
import { updateSettings, useSettings } from "./settings";
import { Choice } from "./SettingsPage";
import { Sheet, useCompact } from "./surface";
import { listMotion } from "./motion";
import type { Session, SyncStatus } from "./sync/session";
import type { Fields } from "./sync/storage";

export function Tip({
  label,
  keys,
  children,
}: {
  label: string;
  keys?: string;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="tooltip">
            {label}
            {keys && <kbd>{keys}</kbd>}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Library edits. Each one uploads shortly after; archive and remove can be
 * undone. A card that leaves or returns moves the cards around it.
 */
export function useActions() {
  const session = useSession();
  const run = (work: () => Promise<unknown>) =>
    listMotion(work).then(
      () => {
        session.syncSoon();
        return true;
      },
      (error) => {
        reportError(error);
        return false;
      },
    );
  const library = (article: Article, fields: Fields) => () =>
    editLibrary(session.arctic, article, fields);
  return {
    favourite: (article: Article) =>
      run(library(article, edits.favourite(!article.favourite))),
    archive: (article: Article) => {
      const archived = !article.archived;
      return run(library(article, edits.archive(archived))).then(
        (done) =>
          done &&
          showToast(archived ? "Archived" : "Moved to Saved", {
            label: "Undo",
            run: () => void run(library(article, edits.archive(!archived))),
          }),
      );
    },
    save: (article: Article) =>
      run(library(article, edits.save())).then(
        (done) => done && showToast("Saved"),
      ),
    remove: (article: Article) => {
      let undo: (() => Promise<void>) | undefined;
      return run(async () => {
        undo = await removeArticle(session.arctic, session.copies, article);
      }).then(
        (done) =>
          done &&
          undo &&
          showToast("Removed from your library", {
            label: "Undo",
            run: () => void run(undo!),
          }),
      );
    },
  };
}

export function ArticleMenu({
  article,
  trigger,
  onRemoved,
}: {
  article: Article;
  trigger: ReactElement<{ onClick?: () => void }>;
  onRemoved?: () => void;
}) {
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  if (compact)
    return (
      <>
        {cloneElement(trigger, { onClick: () => setOpen(true) })}
        <ActionSheet
          article={open ? article : null}
          onClose={() => setOpen(false)}
          onRemoved={onRemoved}
          inToolbar
        />
      </>
    );
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger render={trigger} />
      <ArticleMenuPopup article={article} onRemoved={onRemoved} />
    </Menu.Root>
  );
}

/**
 * A phone's article menu: a sheet that names the article, with rows a thumb
 * can reach. It keeps its article while it closes.
 */
export function ActionSheet({
  article,
  onClose,
  onRemoved,
  inToolbar = false,
}: {
  article: Article | null;
  onClose: () => void;
  onRemoved?: () => void;
  /** Favourite and Archive are already in the reader's toolbar. */
  inToolbar?: boolean;
}) {
  const [shown, setShown] = useState(article);
  if (article && article !== shown) setShown(article);
  return (
    <Sheet
      isOpen={article !== null}
      onOpenChange={(open) => !open && onClose()}
      title={shown ? `Actions for ${shown.title}` : "Actions"}
    >
      {shown && (
        <ActionRows
          article={shown}
          onClose={onClose}
          onRemoved={onRemoved}
          inToolbar={inToolbar}
        />
      )}
    </Sheet>
  );
}

function ActionRows({
  article,
  onClose,
  onRemoved,
  inToolbar,
}: {
  article: Article;
  onClose: () => void;
  onRemoved?: () => void;
  inToolbar: boolean;
}) {
  const actions = useActions();
  const row = (
    icon: ReactNode,
    label: string,
    run: () => void,
    danger = false,
  ) => (
    <button
      type="button"
      className={danger ? "action-row danger" : "action-row"}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );
  const share =
    typeof navigator.share === "function"
      ? () =>
          void navigator
            .share({ title: article.title, url: article.url })
            .catch(() => {})
      : undefined;
  return (
    <div className="action-sheet">
      <header className="action-head">
        <span className="action-host">{article.host}</span>
        <strong>{article.title}</strong>
      </header>
      <div className="action-group" hidden={inToolbar && article.saved}>
        {article.saved ? (
          <>
            {row(
              <Star size={20} />,
              article.favourite ? "Remove from Favourites" : "Favourite",
              () => void actions.favourite(article),
            )}
            {row(
              article.archived ? (
                <ArchiveRestore size={20} />
              ) : (
                <Archive size={20} />
              ),
              article.archived ? "Move to Saved" : "Archive",
              () => void actions.archive(article),
            )}
          </>
        ) : (
          row(<BookmarkPlus size={20} />, "Save to library", () =>
            void actions.save(article),
          )
        )}
      </div>
      <div className="action-group">
        {row(<ArrowUpRight size={20} />, "Open original", () =>
          window.open(article.url, "_blank", "noopener,noreferrer"),
        )}
        {share
          ? row(<Share size={20} />, "Share", share)
          : row(<Link2 size={20} />, "Copy link", () =>
              navigator.clipboard
                .writeText(article.url)
                .then(() => showToast("Link copied"), reportError),
            )}
      </div>
      <div className="action-group">
        {row(
          <Trash2 size={20} />,
          "Remove from library",
          () => {
            void actions.remove(article);
            onRemoved?.();
          },
          true,
        )}
      </div>
    </div>
  );
}

/**
 * One menu serves every card in the library. A card has a plain button, so a
 * long library mounts no menu machinery per card.
 */
type CardMenuState = { article: Article; anchor: HTMLElement } | null;
let cardMenu: CardMenuState = null;
const cardMenuListeners = new Set<() => void>();
function setCardMenu(next: CardMenuState) {
  cardMenu?.anchor.setAttribute("aria-expanded", "false");
  next?.anchor.setAttribute("aria-expanded", "true");
  cardMenu = next;
  cardMenuListeners.forEach((listener) => listener());
}

export function CardMenu() {
  const opened = useSyncExternalStore(
    (listener) => {
      cardMenuListeners.add(listener);
      return () => cardMenuListeners.delete(listener);
    },
    () => cardMenu,
  );
  // The popup keeps its article while it closes.
  const [shown, setShown] = useState(opened);
  if (opened && opened !== shown) setShown(opened);
  const compact = useCompact();
  if (compact)
    return (
      <ActionSheet
        article={opened?.article ?? null}
        onClose={() => setCardMenu(null)}
      />
    );
  return (
    <Menu.Root
      open={opened !== null}
      modal={false}
      onOpenChange={(open, details) => {
        if (open) return;
        // A press on the open card's button closes the menu with its click.
        if (
          details.reason === "outside-press" &&
          opened?.anchor.contains(details.event.target as Node)
        )
          return details.cancel();
        setCardMenu(null);
      }}
    >
      {shown && (
        <ArticleMenuPopup article={shown.article} anchor={shown.anchor} />
      )}
    </Menu.Root>
  );
}

export function CardMenuButton({ article }: { article: Article }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={`More for ${article.title}`}
      aria-haspopup="menu"
      aria-expanded="false"
      onClick={(event) => {
        const anchor = event.currentTarget;
        setCardMenu(cardMenu?.anchor === anchor ? null : { article, anchor });
      }}
    >
      <MoreHorizontal size={18} />
    </button>
  );
}

function ArticleMenuPopup({
  article,
  anchor,
  onRemoved,
}: {
  article: Article;
  /** Positions a menu that has no trigger; focus returns here after a key closes it. */
  anchor?: HTMLElement;
  onRemoved?: () => void;
}) {
  const actions = useActions();
  return (
    <Menu.Portal>
      <Menu.Positioner sideOffset={6} align="end" anchor={anchor}>
        <Menu.Popup
          className="menu"
          finalFocus={
            anchor && ((type) => (type === "keyboard" ? anchor : true))
          }
        >
          {article.saved ? (
            <>
              <Item
                icon={<Star size={16} />}
                keys="F"
                onClick={() => actions.favourite(article)}
              >
                {article.favourite ? "Remove from Favourites" : "Favourite"}
              </Item>
              <Item
                icon={
                  article.archived ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Archive size={16} />
                  )
                }
                keys="E"
                onClick={() => actions.archive(article)}
              >
                {article.archived ? "Move to Saved" : "Archive"}
              </Item>
            </>
          ) : (
            <Item
              icon={<BookmarkPlus size={16} />}
              onClick={() => actions.save(article)}
            >
              Save to library
            </Item>
          )}
          <Item
            icon={<ArrowUpRight size={16} />}
            keys="O"
            onClick={() =>
              window.open(article.url, "_blank", "noopener,noreferrer")
            }
          >
            Open original
          </Item>
          <Item
            icon={<Link2 size={16} />}
            onClick={() =>
              navigator.clipboard
                .writeText(article.url)
                .then(() => showToast("Link copied"), reportError)
            }
          >
            Copy link
          </Item>
          <Menu.Separator className="menu-separator" />
          <Item
            icon={<Trash2 size={16} />}
            danger
            onClick={() => {
              void actions.remove(article);
              onRemoved?.();
            }}
          >
            Remove from library
          </Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function Item({
  icon,
  keys,
  danger,
  onClick,
  children,
}: {
  icon: ReactNode;
  keys?: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Menu.Item
      className={danger ? "menu-item danger" : "menu-item"}
      onClick={onClick}
    >
      {icon}
      {children}
      {keys && <kbd>{keys}</kbd>}
    </Menu.Item>
  );
}

export function describeStatus(status: SyncStatus, pending: number) {
  const ago = (time?: number) => {
    if (!time) return "";
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24
      ? `${hours} h ago`
      : new Date(time).toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
        });
  };
  switch (status.phase) {
    case "loading":
      return "Opening your library…";
    case "syncing":
      return "Syncing…";
    case "synced":
      return pending
        ? `${pending} changes to upload`
        : `Synced ${ago(status.lastSyncedAt)}`;
    case "offline":
      return pending
        ? `Offline. ${pending} changes will upload later.`
        : "Offline. Showing this browser's copy.";
    case "error":
      return status.message;
  }
}

/** The account and its places. In the sidebar it is a row with the name. */
export function AccountMenu({ row = false }: { row?: boolean }) {
  const session = useSession();
  const status = useStatus();
  const navigate = useNavigate();
  const compact = useCompact();
  const [open, setOpen] = useState(false);
  const { account } = session;
  const face = account.image ? (
    <img src={account.image} alt="" referrerPolicy="no-referrer" />
  ) : (
    (account.name || account.email).slice(0, 1).toUpperCase()
  );
  const places: [ReactNode, string, string][] = [
    [<Highlighter size={compact ? 20 : 16} />, "Highlights", "/highlights"],
    [<Clock size={compact ? 20 : 16} />, "Reading time", "/reading"],
    [<FileText size={compact ? 20 : 16} />, "Article text", "/copies"],
    [<Settings size={compact ? 20 : 16} />, "Settings", "/settings"],
  ];
  if (compact)
    return (
      <>
        <button
          type="button"
          className="avatar"
          aria-label="Account"
          onClick={() => setOpen(true)}
        >
          {face}
        </button>
        <Sheet isOpen={open} onOpenChange={setOpen} title="Account">
          <AccountSheet
            status={describeStatus(status, session.pendingCount)}
            places={places}
            onClose={() => setOpen(false)}
            onGo={(path) => {
              setOpen(false);
              navigate(path);
            }}
          />
        </Sheet>
      </>
    );
  return (
    <Menu.Root modal={false}>
      {row ? (
        <Menu.Trigger
          className="side-item side-account"
          aria-label="Account"
          render={<button type="button" />}
        >
          <span className="avatar">{face}</span>
          <span className="side-name">{account.name || account.email}</span>
        </Menu.Trigger>
      ) : (
        <Menu.Trigger
          className="avatar"
          aria-label="Account"
          render={<button type="button" />}
        >
          {face}
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={8}
          align={row ? "start" : "end"}
          side={row ? "top" : "bottom"}
        >
          <Menu.Popup className="menu">
            <div className="menu-account">
              <strong>{account.name || account.email}</strong>
              {account.email}
              <br />
              {describeStatus(status, session.pendingCount)}
            </div>
            <Menu.Separator className="menu-separator" />
            <Item
              icon={<RefreshCw size={16} />}
              onClick={() => void session.sync().catch(() => {})}
            >
              Sync now
            </Item>
            {places.map(([icon, label, path]) => (
              <Item key={path} icon={icon} onClick={() => navigate(path)}>
                {label}
              </Item>
            ))}
            <Menu.Separator className="menu-separator" />
            <Item
              icon={<LogOut size={16} />}
              onClick={() => void leave(session)}
            >
              Sign out
            </Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function AccountSheet({
  status,
  places,
  onClose,
  onGo,
}: {
  status: string;
  places: [ReactNode, string, string][];
  onClose: () => void;
  onGo: (path: string) => void;
}) {
  const session = useSession();
  const { account } = session;
  const { layout } = useSettings();
  return (
    <div className="action-sheet">
      <header className="action-head">
        <strong>{account.name || account.email}</strong>
        <span className="action-host">{account.email}</span>
      </header>
      <div className="action-group">
        <button
          type="button"
          className="action-row"
          onClick={() => void session.sync().catch(() => {})}
        >
          <RefreshCw size={20} />
          Sync now
          <span className="action-detail">{status}</span>
        </button>
        <div className="action-row static">
          <LayoutGrid size={20} />
          Library
          <Choice
            label="Library layout"
            className="segmented action-choice"
            value={layout}
            options={[
              ["cards", "Cards"],
              ["list", "List"],
            ]}
            onChange={(next) => updateSettings({ layout: next })}
          />
        </div>
      </div>
      <div className="action-group">
        {places.map(([icon, label, path]) => (
          <button
            key={path}
            type="button"
            className="action-row"
            onClick={() => onGo(path)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
      <div className="action-group">
        <button
          type="button"
          className="action-row"
          onClick={() => {
            onClose();
            void leave(session);
          }}
        >
          <LogOut size={20} />
          Sign out
        </button>
      </div>
    </div>
  );
}

/** Signing out removes this browser's copy. Unsent edits upload first when possible. */
async function leave(session: Session) {
  if (session.pendingCount) await session.sync().catch(() => {});
  if (
    session.pendingCount &&
    !confirm(
      `${session.pendingCount} changes have not uploaded. Sign out and discard them?`,
    )
  )
    return;
  try {
    await signOut();
  } catch (error) {
    reportError(error);
    return;
  }
  await session.forget();
  location.assign("/");
}

export function Toaster() {
  const toast = useToast();
  if (!toast) return null;
  return (
    <div
      className="toast"
      role="status"
      key={toast.id}
      onPointerEnter={() => holdToast(true)}
      onPointerLeave={() => holdToast(false)}
      onFocus={() => holdToast(true)}
      onBlur={() => holdToast(false)}
    >
      {toast.message}
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.run();
            dismissToast();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

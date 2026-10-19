import { Menu } from "@base-ui/react/menu";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BookmarkPlus,
  FileText,
  Link2,
  LogOut,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "./api";
import { edits, editLibrary, removeArticle, type Article } from "./articles";
import {
  dismissToast,
  reportError,
  showToast,
  useSession,
  useStatus,
  useToast,
} from "./state";
import type { Session, SyncStatus } from "./sync/session";

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

/** Library edits. Each one uploads shortly after; archive and remove can be undone. */
export function useActions() {
  const session = useSession();
  const run = (work: Promise<unknown>) =>
    work.then(() => session.syncSoon(), reportError);
  return {
    favourite: (article: Article) =>
      run(
        editLibrary(
          session.arctic,
          article,
          edits.favourite(!article.favourite),
        ),
      ),
    archive: (article: Article) => {
      const archived = !article.archived;
      return run(
        editLibrary(session.arctic, article, edits.archive(archived)).then(() =>
          showToast(archived ? "Archived" : "Moved to Saved", {
            label: "Undo",
            run: () =>
              void run(
                editLibrary(session.arctic, article, edits.archive(!archived)),
              ),
          }),
        ),
      );
    },
    save: (article: Article) =>
      run(
        editLibrary(session.arctic, article, edits.save()).then(() =>
          showToast("Saved"),
        ),
      ),
    remove: (article: Article) =>
      run(
        removeArticle(session.arctic, session.copies, article).then((undo) =>
          showToast("Removed from your library", {
            label: "Undo",
            run: () => void run(undo()),
          }),
        ),
      ),
  };
}

export function ArticleMenu({
  article,
  trigger,
  onRemoved,
}: {
  article: Article;
  trigger: ReactElement;
  onRemoved?: () => void;
}) {
  const actions = useActions();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="menu">
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
    </Menu.Root>
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

export function AccountMenu() {
  const session = useSession();
  const status = useStatus();
  const navigate = useNavigate();
  const { account } = session;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="avatar"
        aria-label="Account"
        render={<button type="button" />}
      >
        {account.image ? (
          <img src={account.image} alt="" referrerPolicy="no-referrer" />
        ) : (
          (account.name || account.email).slice(0, 1).toUpperCase()
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end">
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
            <Item
              icon={<FileText size={16} />}
              onClick={() => navigate("/copies")}
            >
              Article text
            </Item>
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
    <div className="toast" role="status" key={toast.id}>
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

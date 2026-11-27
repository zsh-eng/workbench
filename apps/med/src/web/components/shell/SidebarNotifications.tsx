import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentReplyNotification } from "../../../shared/notifications";
import type { PullInbox } from "../../../shared/pull-inbox";
import type { Thread } from "../../../shared/threads";
import { markCommentsRead, unmarkCommentRead, useCommentReads } from "../../data/comment-reads";
import {
  buildSidebarNotifications,
  compactAge,
  dismissNotification,
  markReviewsRead,
  readCommentReplyNotifications,
  setNotificationRead,
  useNotificationReads,
  versionOfNotification,
  type NotificationKind,
  type SidebarNotification,
} from "../../data/notifications";
import { readPullInbox } from "../../data/pull-inbox";
import { useMinuteClock } from "../../data/relative-time";
import type { ReadState } from "../../data/tabs";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";

const SECTIONS: { kind: NotificationKind; title: string }[] = [
  { kind: "needs-you", title: "Needs you" },
  { kind: "pull", title: "Pull requests" },
  { kind: "comment", title: "Comments" },
  { kind: "thread", title: "Threads" },
];

function kindIcon(item: SidebarNotification): IconName {
  if (item.kind === "pull") return "pullRequest";
  if (item.kind === "comment") return "commentAdd";
  if (item.agent === "claude") return "claude";
  if (item.agent === "codex") return "codex";
  return "bell";
}

/**
 * Notifications inside the sidebar itself: uses SessionSidebar's exact quiet
 * typography, muted icons, single-dot unread grammar, and hover menu. Clicking
 * a row opens its thread, comment, or pull request right beside the sidebar.
 */
export function SidebarNotifications({
  threads,
  current,
  read,
  fetcher,
  onOpenThread,
  onOpenPull,
}: {
  threads: readonly Thread[];
  current: string | null;
  read: ReadState;
  fetcher: typeof fetch;
  onOpenThread(thread: Thread): void;
  onOpenPull?(url: string, agent?: string): void;
}) {
  const now = useMinuteClock(true);
  const commentReads = useCommentReads();
  const notifReads = useNotificationReads();
  const [commentReplies, setCommentReplies] = useState<CommentReplyNotification[]>([]);
  const [pulls, setPulls] = useState<PullInbox | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    void Promise.allSettled([
      readCommentReplyNotifications(abort.signal, fetcher),
      readPullInbox(false, "kept", abort.signal, fetcher),
    ]).then(([commentsResult, pullsResult]) => {
      if (abort.signal.aborted || !mounted.current) return;
      if (commentsResult.status === "fulfilled") setCommentReplies(commentsResult.value);
      if (pullsResult.status === "fulfilled") setPulls(pullsResult.value);
      void readPullInbox(false, "fresh", abort.signal, fetcher)
        .then((fresh) => {
          if (!abort.signal.aborted && mounted.current) setPulls(fresh);
        })
        .catch(() => {});
    });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, [fetcher]);

  const items = useMemo(
    () =>
      buildSidebarNotifications({
        tabs: threads,
        isUnread: read.isUnread,
        commentReplies,
        commentReads,
        pulls,
        notifReads,
      }),
    [threads, read, commentReplies, commentReads, pulls, notifReads],
  );

  const unreadCount = useMemo(() => items.filter((item) => item.unread).length, [items]);
  const canMarkAllRead = useMemo(
    () => items.some((item) => item.unread && item.kind !== "needs-you"),
    [items],
  );

  const markRead = useCallback(
    (item: SidebarNotification, nextRead: boolean) => {
      if (item.kind === "needs-you") return;
      if (item.thread) {
        read.setUnread(item.thread, !nextRead);
        if (nextRead) {
          const unreadReviewIds = item.thread.reviews
            .filter((review) => review.unread)
            .map((review) => review.id);
          if (unreadReviewIds.length) void markReviewsRead(unreadReviewIds, fetcher);
        }
      } else if (item.comment) {
        if (nextRead) {
          markCommentsRead([{ id: item.comment.commentId, answeredAt: item.comment.answeredAt }]);
        } else {
          unmarkCommentRead(item.comment.commentId);
        }
      } else if (item.pull) {
        setNotificationRead(item.id, item.pull.updatedAt, nextRead);
      }
    },
    [fetcher, read],
  );

  const markAllRead = useCallback(() => {
    const commentsToMark: { id: string; answeredAt: string }[] = [];
    const reviewIds: string[] = [];
    for (const item of items) {
      if (!item.unread || item.kind === "needs-you") continue;
      if (item.thread) {
        read.setUnread(item.thread, false);
        for (const review of item.thread.reviews) {
          if (review.unread) reviewIds.push(review.id);
        }
      } else if (item.comment) {
        commentsToMark.push({ id: item.comment.commentId, answeredAt: item.comment.answeredAt });
      } else if (item.pull) {
        setNotificationRead(item.id, item.pull.updatedAt, true);
      }
    }
    if (commentsToMark.length) markCommentsRead(commentsToMark);
    if (reviewIds.length) void markReviewsRead(reviewIds, fetcher);
  }, [fetcher, items, read]);

  const openItem = useCallback(
    (item: SidebarNotification) => {
      markRead(item, true);
      if (item.pull) {
        if (onOpenPull) onOpenPull(item.pull.url);
        else window.open(item.pull.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (item.thread) {
        onOpenThread(item.thread);
        return;
      }
      if (item.comment) {
        const owner = threads.find((thread) => thread.id === item.comment!.threadId);
        if (owner) onOpenThread(owner);
      }
    },
    [markRead, onOpenPull, onOpenThread, threads],
  );

  const grouped = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        rows: items.filter((item) => item.kind === section.kind),
      })).filter((section) => section.rows.length > 0),
    [items],
  );

  return (
    <div aria-label="Notifications" {...stylex.props(styles.root)}>
      {unreadCount > 0 && (
        <div {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.unreadLabel)}>{unreadCount} unread</span>
          {canMarkAllRead && (
            <button type="button" onClick={markAllRead} {...stylex.props(styles.headAction)}>
              Mark all read
            </button>
          )}
        </div>
      )}

      {grouped.length === 0 ? (
        <p {...stylex.props(styles.empty)}>
          All caught up. PR reviews, comment replies, and replies in threads show here.
        </p>
      ) : (
        grouped.map((section, index) => (
          <section key={section.kind} aria-label={section.title}>
            <h3
              {...stylex.props(
                styles.sectionLabel,
                index === 0 && unreadCount > 0 && styles.sectionLabelTight,
              )}
            >
              {section.title}
            </h3>
            {section.rows.map((item) => {
              const isCurrent = !!item.thread && item.thread.id === current;
              const menuOpen = menuOpenId === item.id;
              const dotLabel =
                item.dot === "halted" ? "Stopped" : item.dot === "needs" ? "Needs you" : "Unread";
              return (
                <div
                  key={item.id}
                  data-notification-row=""
                  {...stylex.props(styles.rowBox, stylex.defaultMarker())}
                >
                  <button
                    type="button"
                    aria-current={isCurrent ? "page" : undefined}
                    onClick={() => openItem(item)}
                    {...stylex.props(
                      styles.row,
                      isCurrent && styles.current,
                      menuOpen && !isCurrent && styles.held,
                      !item.unread && styles.readRow,
                    )}
                  >
                    <div {...stylex.props(styles.lineOne)}>
                      <span {...stylex.props(styles.title)}>{item.title}</span>
                      <span {...stylex.props(styles.meta, menuOpen && styles.metaHidden)}>
                        <span {...stylex.props(styles.age)}>{compactAge(item.at, now)}</span>
                        {item.dot && (
                          <span
                            role="img"
                            aria-label={dotLabel}
                            {...stylex.props(
                              styles.dot,
                              item.dot === "halted" ? styles.halted : styles.fresh,
                              item.dot === "needs" && styles.needs,
                            )}
                          />
                        )}
                      </span>
                    </div>
                    <div {...stylex.props(styles.lineTwo)}>
                      <span {...stylex.props(styles.icon)}>
                        <Icon name={kindIcon(item)} size={12} />
                      </span>
                      <span {...stylex.props(styles.detail)}>{item.detail}</span>
                    </div>
                  </button>

                  <Menu.Root
                    open={menuOpen}
                    onOpenChange={(open) =>
                      setMenuOpenId((cur) => (open ? item.id : cur === item.id ? null : cur))
                    }
                  >
                    <Menu.Trigger
                      aria-label={`Notification actions for ${item.title}`}
                      {...stylex.props(
                        ui.button,
                        ui.iconButton,
                        styles.more,
                        menuOpen && styles.moreShown,
                      )}
                    >
                      <Icon name="more" size={14} />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        side="bottom"
                        align="end"
                        sideOffset={4}
                        {...stylex.props(styles.positioner)}
                      >
                        <Menu.Popup {...stylex.props(ui.popup, ui.pop, styles.menu)}>
                          {item.kind !== "needs-you" && (
                            <Menu.Item
                              onClick={() => markRead(item, item.unread)}
                              className={(state) =>
                                stylex.props(
                                  ui.menuItem,
                                  styles.item,
                                  state.highlighted && ui.menuHighlighted,
                                ).className
                              }
                            >
                              {item.unread ? "Mark as read" : "Mark as unread"}
                            </Menu.Item>
                          )}
                          {item.pull && (
                            <Menu.Item
                              onClick={() =>
                                window.open(item.pull!.url, "_blank", "noopener,noreferrer")
                              }
                              className={(state) =>
                                stylex.props(
                                  ui.menuItem,
                                  styles.item,
                                  state.highlighted && ui.menuHighlighted,
                                ).className
                              }
                            >
                              Open on GitHub
                            </Menu.Item>
                          )}
                          <Menu.Item
                            onClick={() =>
                              dismissNotification(item.id, versionOfNotification(item))
                            }
                            className={(state) =>
                              stylex.props(
                                ui.menuItem,
                                styles.item,
                                state.highlighted && ui.menuHighlighted,
                              ).className
                            }
                          >
                            Dismiss
                          </Menu.Item>
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    paddingBottom: 12,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginInline: 10,
    marginTop: 10,
    marginBottom: 0,
  },
  unreadLabel: {
    flex: "1",
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  },
  headAction: {
    paddingBlock: 2,
    paddingInline: 6,
    marginInlineEnd: -6,
    borderWidth: 0,
    borderRadius: 6,
    color: { default: tokens.muted, ":hover": tokens.text },
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "default",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  sectionLabel: {
    marginTop: 14,
    marginBottom: 4,
    marginInline: 10,
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 500,
  },
  sectionLabelTight: {
    marginTop: 10,
  },
  empty: {
    marginTop: 10,
    marginInline: 10,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  rowBox: {
    position: "relative",
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "100%",
    boxSizing: "border-box",
    paddingBlock: 6,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "start",
    cursor: "default",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  current: {
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
  },
  held: {
    backgroundColor: tokens.fill,
  },
  readRow: {
    opacity: 0.72,
  },
  lineOne: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  title: {
    flex: "1",
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.35,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  meta: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flex: "none",
    opacity: { default: 1, [stylex.when.ancestor(":hover")]: 0 },
  },
  metaHidden: {
    opacity: 0,
  },
  age: {
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  dot: {
    flex: "none",
    width: 7,
    height: 7,
    marginInlineEnd: 2,
    borderRadius: "50%",
  },
  fresh: { backgroundColor: tokens.accent },
  needs: { boxShadow: `0 0 0 2.5px ${tokens.accentSoft}` },
  halted: { backgroundColor: tokens.warning },
  lineTwo: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    minWidth: 0,
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.35,
  },
  icon: {
    display: "inline-flex",
    flex: "none",
    color: tokens.faint,
  },
  detail: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  more: {
    position: "absolute",
    insetInlineEnd: 4,
    top: 5,
    width: 24,
    minWidth: 24,
    height: 24,
    minHeight: 0,
    paddingInline: 0,
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover")]: 1,
    },
    backgroundColor: tokens.hover,
    color: tokens.muted,
  },
  moreShown: { opacity: 1 },
  positioner: { zIndex: 60 },
  menu: { minWidth: 164, width: "max-content", borderRadius: 12 },
  item: { borderRadius: 8, whiteSpace: "nowrap" },
});

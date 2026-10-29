import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import { foundSessionThread, keepFoundThread } from "../../data/found-threads";
import { resumeCommand, type WorkspaceSession } from "../../data/workspaces";
import { tokens, ui } from "../../theme.stylex";
import type { FileRefs } from "../FileRefs";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";
import { useShell, useThread, useWorkspace, useWorkspaceEntry } from "../Workspaces";
import { SessionPanel } from "./SessionPanel";
import { column } from "./session-styles";

const agentNames = { claude: "Claude Code", codex: "Codex" } as const;

/**
 * The Session pane of a session that Med found: its thread, read from its
 * transcript and followed while the agent works. In place of the message
 * box, it says where the session runs, gives its resume command, and offers
 * Keep in Med, which saves it as a thread.
 */
export function FoundSessionPane({
  session,
  root,
  fetcher,
  controls,
  onOpenPath,
  fileRefs,
  onClose,
  onSideRoom,
  openAgent,
}: {
  session: WorkspaceSession;
  /** Shows this subagent's tab once for each nonce (SessionPanel). */
  openAgent?: { id: string; nonce: number };
  /** The checkout's path, to open absolute links to its files. */
  root?: string;
  fetcher?: typeof fetch;
  controls?: ReactNode;
  onOpenPath(path: string, line?: number): void;
  fileRefs?: FileRefs;
  onClose(): void;
  /** Whether the pane has room for the side panel (SessionPanel). */
  onSideRoom?(room: boolean): void;
}) {
  const workspace = useWorkspace();
  const entry = useWorkspaceEntry();
  const shell = useShell();
  const threadId = foundSessionThread(session);
  const thread = useThread(threadId);
  const checkout = entry?.kind === "repository" ? entry.path : undefined;
  const title = thread?.title ?? entry?.title;
  // The window's title band names the checkout; without the shell, the header does.
  const place = shell
    ? undefined
    : [
        entry?.repository ?? checkout?.split("/").at(-1),
        entry?.kind === "repository" && entry.branch,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <SessionPanel
      reviewId={threadId}
      sessions={[session]}
      {...(title ? { title } : {})}
      {...(place ? { detail: place } : {})}
      root={root}
      fetcher={fetcher}
      controls={controls}
      onOpenPath={onOpenPath}
      {...(fileRefs && { fileRefs })}
      onClose={onClose}
      {...(onSideRoom && { onSideRoom })}
      {...(openAgent && { openAgent })}
      footer={
        <FoundSessionBar
          session={session}
          keep={
            checkout
              ? async () => {
                  const review = await keepFoundThread(
                    { title: title ?? "Agent session", checkout, session },
                    fetcher,
                  );
                  // The saved thread takes this workspace's place.
                  workspace?.open({ kind: "review", reviewId: review.id, title: review.title });
                  if (workspace) workspace.close(workspace.id);
                }
              : undefined
          }
        />
      }
    />
  );
}

function FoundSessionBar({
  session,
  keep,
}: {
  session: WorkspaceSession;
  /** Saves the session as a thread; without a checkout there is none. */
  keep?: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [keeping, setKeeping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const name = agentNames[session.agent];
  const command =
    session.agent === "claude" ? `claude --resume ${session.id}` : `codex resume ${session.id}`;
  return (
    <div role="group" aria-label={`Runs in ${name}`} {...stylex.props(styles.box, column.bar)}>
      <div {...stylex.props(styles.row)}>
        <span {...stylex.props(styles.place)}>
          <Icon name={session.agent} size={13} />
          Runs in {name}
        </span>
        {keep && (
          <button
            type="button"
            disabled={keeping}
            {...tooltip("Save it as a thread, so you can comment and reply")}
            onClick={() => {
              setKeeping(true);
              setError(null);
              keep()
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : "Med did not keep it."),
                )
                .finally(() => setKeeping(false));
            }}
            {...stylex.props(ui.button, ui.pressable, ui.primary, styles.keep)}
          >
            {keeping ? "Keeping…" : "Keep in Med"}
          </button>
        )}
      </div>
      <div {...stylex.props(styles.row)}>
        <code {...stylex.props(styles.command)} title={resumeCommand(session)}>
          {command}
        </code>
        <button
          type="button"
          aria-label={`Copy ${name} resume command`}
          {...tooltip("Copy the command, with cd to its folder")}
          onClick={() =>
            void navigator.clipboard.writeText(resumeCommand(session)).then(
              () => setCopied(true),
              () => setError("The browser did not allow a copy. Select the command instead."),
            )
          }
          {...stylex.props(ui.button, ui.pressable, styles.copy)}
        >
          <span role={copied ? "status" : undefined}>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  // The message box's place and shape (SessionComposer), without its field.
  box: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginInline: 12,
    marginBottom: 12,
    paddingTop: 8,
    paddingBottom: 6,
    paddingInline: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  row: { display: "flex", alignItems: "center", gap: 8, minWidth: 0, minHeight: 26 },
  place: {
    flex: "1",
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  keep: { flexShrink: 0, minHeight: 26, paddingInline: 10 },
  command: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
    userSelect: "all",
  },
  copy: { flexShrink: 0, minHeight: 24, marginInlineEnd: -4 },
  error: { margin: 0, color: tokens.red, fontSize: 11.5, lineHeight: 1.45 },
});

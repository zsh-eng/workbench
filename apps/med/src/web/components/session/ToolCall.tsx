import { MultiFileDiff } from "@pierre/diffs/react";
import * as stylex from "@stylexjs/stylex";
import { memo, useMemo, useState, type ReactNode } from "react";
import type { ToolCallContent, ToolKind } from "../../../shared/agent-session";
import type { SessionItem, ToolCallState } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { useTheme } from "../../themes";
import { diffSurfaceStyle } from "../diff-surface";
import { Icon, type IconName } from "../Icon";
import { motion, rowStyles } from "./session-styles";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;
type DiffContent = Extract<ToolCallContent, { type: "diff" }>;

const ICONS: Record<ToolKind, IconName> = {
  read: "file",
  edit: "edit",
  delete: "trash",
  move: "file",
  search: "search",
  execute: "terminal",
  think: "tasks",
  fetch: "globe",
  switch_mode: "settings",
  other: "command",
};

/** The first word of a title, by state: "Edit" reads "Editing", then "Edited". */
const VERBS: Record<string, [running: string, done: string]> = {
  Read: ["Reading", "Read"],
  Edit: ["Editing", "Edited"],
  Write: ["Writing", "Wrote"],
  Search: ["Searching", "Searched"],
  Find: ["Finding", "Found"],
  Fetch: ["Fetching", "Fetched"],
};

export const isSubagent = (call: ToolCallState) => call.tool === "Agent" || call.tool === "Task";
const diffsOf = (call: ToolCallState) =>
  call.content.filter((part): part is DiffContent => part.type === "diff");
const textOf = (call: ToolCallState) =>
  call.content
    .map((part) =>
      part.type === "content" && part.content.type === "text" ? part.content.text : "",
    )
    .filter(Boolean)
    .join("\n");
const commandOf = (call: ToolCallState) => {
  const input = call.rawInput as { command?: unknown } | undefined;
  return typeof input?.command === "string" ? input.command : undefined;
};
const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Added and removed lines of a diff with one changed region. */
export function diffStat(diff: DiffContent) {
  const before = diff.oldText ? diff.oldText.split("\n") : [];
  const after = diff.newText.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return { added: after.length - start - end, removed: before.length - start - end };
}

export function formatSeconds(milliseconds: number) {
  const seconds = milliseconds / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function phrase(call: ToolCallState): { verb?: string; target: string } {
  if (call.kind === "execute" || isSubagent(call)) return { target: call.title };
  const space = call.title.indexOf(" ");
  const first = space < 0 ? call.title : call.title.slice(0, space);
  const verbs = VERBS[first];
  if (!verbs || call.status === "failed") return { target: call.title };
  const created = call.tool === "Write" && diffsOf(call)[0]?.oldText == null;
  const done = call.status === "completed";
  const verb = created ? (done ? "Created" : "Creating") : verbs[done ? 1 : 0];
  return { verb, target: space < 0 ? "" : call.title.slice(space + 1) };
}

/**
 * One tool call as a row that opens to show its work: a command and its
 * output, the diff of an edit, or the thread of a subagent.
 */
export const ToolCall = memo(function ToolCall({
  item,
  renderThread,
}: {
  item: ToolItem;
  /** Renders a subagent's thread inside the call that started it. */
  renderThread(items: SessionItem[]): ReactNode;
}) {
  const { call } = item;
  const diffs = diffsOf(call);
  const subagent = isSubagent(call) || item.items.length > 0;
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  // Edits show their diff until the reader closes it.
  const expanded = open ?? diffs.length > 0;
  const running = call.status === "pending" || call.status === "in_progress";
  const stat = useMemo(
    () =>
      diffs.reduce(
        (total, diff) => {
          const next = diffStat(diff);
          return { added: total.added + next.added, removed: total.removed + next.removed };
        },
        { added: 0, removed: 0 },
      ),
    [diffs],
  );
  const { verb, target } = phrase(call);
  const output = textOf(call);
  const command = commandOf(call);
  const hasDetails =
    diffs.length > 0 || Boolean(output) || Boolean(command) || item.items.length > 0;
  const duration = item.endedAt !== undefined ? item.endedAt - item.at : undefined;

  return (
    <div
      {...stylex.props(styles.call)}
      data-tool-call-id={call.toolCallId}
      data-tool-kind={call.kind}
      data-status={call.status}
    >
      <button
        type="button"
        aria-expanded={hasDetails ? expanded : undefined}
        disabled={!hasDetails}
        onClick={() => setOpen(!expanded)}
        {...stylex.props(rowStyles.row, styles.head)}
      >
        <span {...stylex.props(rowStyles.icon, call.status === "failed" && styles.failedIcon)}>
          <Icon name={subagent ? "agent" : ICONS[call.kind]} size={14} />
        </span>
        <span {...stylex.props(styles.label, running && motion.shimmer)}>
          {verb && <span {...stylex.props(styles.verb)}>{verb} </span>}
          <span {...stylex.props(verb ? styles.target : styles.plain)}>{target}</span>
        </span>
        <span {...stylex.props(styles.meta)}>
          {(stat.added > 0 || stat.removed > 0) && (
            <span {...stylex.props(styles.stat)}>
              {stat.added > 0 && <span {...stylex.props(styles.added)}>+{stat.added}</span>}
              {stat.removed > 0 && <span {...stylex.props(styles.removed)}>−{stat.removed}</span>}
            </span>
          )}
          {call.background && running && (
            <span {...stylex.props(styles.badge)}>
              {call.background.kind === "agent" ? "Agent" : "Shell"} in background
            </span>
          )}
          {call.status === "failed" && <span {...stylex.props(styles.failed)}>Failed</span>}
          {running ? (
            <span aria-label="Running" {...stylex.props(motion.spinner)} />
          ) : (
            duration !== undefined && duration >= 1000 && <span>{formatSeconds(duration)}</span>
          )}
          {hasDetails && (
            <span {...stylex.props(styles.chevron, expanded && styles.chevronOpen)}>
              <Icon name="chevron" size={12} />
            </span>
          )}
        </span>
      </button>
      {expanded && hasDetails && (
        <div {...stylex.props(styles.details)}>
          {command && (
            <pre {...stylex.props(styles.console)}>
              <span {...stylex.props(styles.prompt)}>$ </span>
              {command}
              {output && (
                <span
                  {...stylex.props(styles.output, call.status === "failed" && styles.error)}
                >{`\n${output}`}</span>
              )}
            </pre>
          )}
          {diffs.map((diff, index) => (
            <EditDiff key={`${diff.path}:${index}`} diff={diff} />
          ))}
          {!command && output && !subagent && (
            <pre
              {...stylex.props(
                styles.console,
                styles.output,
                call.status === "failed" && styles.error,
              )}
            >
              {output}
            </pre>
          )}
          {item.items.length > 0 && (
            <div {...stylex.props(styles.nested)}>{renderThread(item.items)}</div>
          )}
        </div>
      )}
    </div>
  );
});

/** Edited text often ends inside a line; a final newline keeps the diff from marking it. */
const ending = (text: string) => (text === "" || text.endsWith("\n") ? text : `${text}\n`);

function EditDiff({ diff }: { diff: DiffContent }) {
  const { active } = useTheme();
  const excerpt = diff._meta?.med?.excerpt === true;
  const name = basename(diff.path);
  const options = useMemo(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      diffStyle: "unified" as const,
      overflow: "wrap" as const,
      diffIndicators: "bars" as const,
      lineDiffType: "word-alt" as const,
      hunkSeparators: "line-info" as const,
      disableFileHeader: true,
      // An excerpt does not know where it sits in the file.
      disableLineNumbers: excerpt,
      unsafeCSS: `[data-separator-content] { font-size: 11px; }`,
    }),
    [active, excerpt],
  );
  return (
    <figure {...stylex.props(styles.diff)}>
      <MultiFileDiff
        oldFile={{ name, contents: ending(diff.oldText ?? "") }}
        newFile={{ name, contents: ending(diff.newText) }}
        options={options}
        style={
          {
            ...diffSurfaceStyle,
            "--diffs-font-size": "11.5px",
            "--diffs-line-height": "18px",
          } as never
        }
      />
    </figure>
  );
}

const styles = stylex.create({
  call: { display: "flex", flexDirection: "column", minWidth: 0 },
  head: { cursor: { default: "pointer", ":disabled": "default" } },
  label: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  verb: { color: tokens.text, fontWeight: 500 },
  target: { color: tokens.muted },
  plain: { color: tokens.text },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  stat: { display: "flex", gap: 5, fontFamily: tokens.code, fontSize: 11 },
  added: { color: tokens.green },
  removed: { color: tokens.red },
  badge: {
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 999,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontSize: 11,
  },
  failed: { color: tokens.red },
  failedIcon: { color: tokens.red },
  chevron: {
    display: "flex",
    color: tokens.faint,
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
  },
  chevronOpen: { transform: "rotate(0deg)" },
  details: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBlock: 4,
    paddingInlineStart: 24,
    minWidth: 0,
  },
  console: {
    margin: 0,
    maxHeight: 220,
    overflow: "auto",
    paddingBlock: 9,
    paddingInline: 11,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.code,
    fontSize: 11.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    scrollbarWidth: "thin",
  },
  prompt: { color: tokens.faint, userSelect: "none" },
  output: { color: tokens.muted },
  error: { color: tokens.red },
  // A long new file scrolls inside its frame, so the thread stays readable.
  diff: {
    margin: 0,
    maxHeight: 360,
    overflowX: "hidden",
    overflowY: "auto",
    scrollbarWidth: "thin",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  nested: {
    paddingInlineStart: 12,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.line,
  },
});

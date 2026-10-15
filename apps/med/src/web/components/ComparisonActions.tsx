import * as stylex from "@stylexjs/stylex";
import { Menu } from "@base-ui/react/menu";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Comparison } from "../../shared/protocol";
import { gitTargetsSchema, pushResultSchema, type GitTargets } from "../../shared/git-actions";
import { createApi } from "../data/api";
import { readBrowserToken } from "../data/auth";
import { ChoiceSelect } from "./Controls";
import { Icon } from "./Icon";
import { tooltip } from "./ToolButton";
import { picked, tokens, ui } from "../theme.stylex";

/** Opens the actions from elsewhere, such as a menu or ⌘K. */
export interface ComparisonActionsHandle {
  /** The base branch menu, below `anchor`. */
  openCompare(): void;
  /** The push dialog; it does nothing without a commit to push or before the
   * remotes load. */
  openPush(): void;
}

/** A checkout's branches and remotes, which the base branch menu and Push
 * need: undefined while Med reads them, with the error of a failed read. */
export function useGitTargets(repo: string | undefined, head: string) {
  const api = useMemo(() => createApi(fetch, readBrowserToken()), []);
  const key = repo ? `${repo}\0${head}` : "";
  const [read, setRead] = useState<{ key: string; targets?: GitTargets; error?: string }>({
    key: "",
  });
  useEffect(() => {
    if (!repo) return;
    const abort = new AbortController();
    void api
      .json(`/api/git/targets?repo=${encodeURIComponent(repo)}`, gitTargetsSchema, {
        signal: abort.signal,
      })
      .then((targets) => {
        if (!abort.signal.aborted) setRead({ key, targets });
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) setRead({ key, error: error.message });
      });
    return () => abort.abort();
  }, [api, repo, key]);
  // A read for another checkout or head is not this one's.
  return read.key === key ? read : { key };
}

export function ComparisonActions({
  repo,
  head,
  sourceBranch,
  comparison,
  onCompare,
  targets,
  targetsError = "",
  triggers = true,
  anchor,
  ref,
}: {
  repo: string;
  head: string;
  sourceBranch: string;
  comparison: Comparison;
  onCompare(base: string, head: string): void;
  /** From useGitTargets. */
  targets?: GitTargets;
  targetsError?: string;
  /** Without them, the menu and the dialog open only through `ref`. */
  triggers?: boolean;
  /** Where the base branch menu opens without its own trigger. */
  anchor?: () => HTMLElement | null;
  ref?: Ref<ComparisonActionsHandle>;
}) {
  const branchList = useId();
  const api = useMemo(() => createApi(fetch, readBrowserToken()), []);
  const [pushError, setError] = useState("");
  const error = pushError || targetsError;
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [remote, setRemote] = useState("");
  const [branch, setBranch] = useState("");
  const pushBusy = useRef(false);
  const [pushing, setPushing] = useState(false);
  const [published, setPublished] = useState("");
  const [pushHead, setPushHead] = useState("");
  const commitHead = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(head) ? head : "";
  const destination = targets?.remotes.find((item) => item.name === remote);
  const existing = destination?.branches.includes(branch.trim());
  const refs =
    targets?.refs.filter((ref) => ref.label.toLowerCase().includes(query.toLowerCase())) ?? [];
  const publish = async () => {
    if (pushBusy.current) return;
    pushBusy.current = true;
    setPushing(true);
    setError("");
    try {
      const result = await api.json("/api/git/push", pushResultSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, head: pushHead, remote, branch: branch.trim() }),
      });
      setPublished(`Pushed ${result.head.slice(0, 8)} to ${result.remote}/${result.branch}`);
      setPushOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pushBusy.current = false;
      setPushing(false);
    }
  };
  const [compareOpen, setCompareOpen] = useState(false);
  const changeCompare = (open: boolean) => {
    if (open) setQuery("");
    setCompareOpen(open);
  };
  const changePush = (open: boolean) => {
    if (pushBusy.current) return;
    if (open) {
      setError("");
      setPublished("");
      setPushHead(commitHead);
      setRemote(targets?.remotes[0]?.name ?? "");
      setBranch(sourceBranch);
    }
    setPushOpen(open);
  };
  useImperativeHandle(ref, () => ({
    openCompare: () => changeCompare(true),
    openPush: () => {
      if (commitHead && targets) changePush(true);
    },
  }));
  return (
    <>
      <Menu.Root
        open={compareOpen}
        onOpenChange={changeCompare}
        onOpenChangeComplete={(open) => {
          if (open) filterRef.current?.focus();
        }}
      >
        {triggers && (
          <Menu.Trigger
            {...stylex.props(
              ui.button,
              styles.trigger,
              comparison.kind === "range" && comparison.mergeBase && ui.strong,
            )}
            aria-label="Compare against base branch"
          >
            {comparison.kind === "range" && comparison.mergeBase ? (
              <>
                <span {...stylex.props(styles.baseLabel)}>Base</span>
                <span {...stylex.props(styles.label)}>
                  {comparison.base.replace(/^refs\/(heads|remotes)\//, "")}
                </span>
              </>
            ) : (
              <span {...stylex.props(styles.label)}>Compare against</span>
            )}
            <span {...stylex.props(styles.chevron)}>
              <Icon name="chevron" size={14} />
            </span>
          </Menu.Trigger>
        )}
        <Menu.Portal>
          <Menu.Positioner
            sideOffset={6}
            {...(triggers ? {} : { anchor, align: "start" as const })}
            {...stylex.props(styles.positioner)}
          >
            <Menu.Popup
              {...(triggers ? {} : { finalFocus: () => anchor?.() ?? true })}
              {...stylex.props(ui.popup, ui.pop, styles.menu)}
            >
              <div {...stylex.props(styles.filter)}>
                <Icon name="search" size={14} />
                <input
                  ref={filterRef}
                  aria-label="Filter comparison branches"
                  placeholder="Find a base branch"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Typing filters; it must not trigger the menu's type-ahead.
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      event.currentTarget
                        .closest('[role="menu"]')
                        ?.querySelector<HTMLElement>(
                          '[role="menuitem"]:not([aria-disabled="true"])',
                        )
                        ?.focus();
                    } else if (event.key !== "Escape" && event.key !== "Tab")
                      event.stopPropagation();
                  }}
                  {...stylex.props(styles.filterInput)}
                />
              </div>
              <p {...stylex.props(styles.menuHint)}>Changes since the common ancestor</p>
              {(
                [
                  ["Local", refs.filter((ref) => !ref.name.startsWith("refs/remotes/"))],
                  ["Remote", refs.filter((ref) => ref.name.startsWith("refs/remotes/"))],
                ] as const
              ).map(([title, group]) =>
                group.length ? (
                  <Menu.Group key={title}>
                    <Menu.GroupLabel {...stylex.props(ui.label, styles.groupLabel)}>
                      {title}
                    </Menu.GroupLabel>
                    {group.map((ref) => {
                      const current =
                        comparison.kind === "range" &&
                        !!comparison.mergeBase &&
                        (comparison.base === ref.name || comparison.base === ref.label);
                      return (
                        <Menu.Item
                          key={ref.name}
                          onClick={() => onCompare(ref.name, commitHead)}
                          disabled={!commitHead}
                          className={(state) =>
                            stylex.props(
                              ui.menuItem,
                              styles.ref,
                              state.highlighted && [ui.menuHighlighted, picked],
                            ).className
                          }
                        >
                          <span {...stylex.props(styles.refName)}>{ref.label}</span>
                          {current && (
                            <span {...stylex.props(styles.current)}>
                              <Icon name="check" size={14} />
                            </span>
                          )}
                        </Menu.Item>
                      );
                    })}
                  </Menu.Group>
                ) : null,
              )}
              {!targets && <p {...stylex.props(styles.menuHint)}>{error || "Loading branches…"}</p>}
              {targets && !refs.length && (
                <p {...stylex.props(styles.menuHint)}>No matching branches.</p>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root open={pushOpen} onOpenChange={changePush}>
        {triggers && (
          <Dialog.Trigger
            {...stylex.props(ui.button, ui.iconButton, ui.pressable)}
            {...tooltip("Push to remote")}
            aria-label="Push"
            disabled={!commitHead || !targets}
          >
            <Icon name="push" size={15} />
          </Dialog.Trigger>
        )}
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop)} />
          <Dialog.Popup {...stylex.props(styles.dialog)}>
            <Dialog.Title {...stylex.props(styles.title)}>Push to remote</Dialog.Title>
            <Dialog.Description {...stylex.props(styles.hint)}>
              Publish commit {pushHead.slice(0, 8)} and its history. Uncommitted files are not
              included.
            </Dialog.Description>
            <p {...stylex.props(styles.repo)}>{repo}</p>
            {targets?.remotes.length ? (
              <>
                <div {...stylex.props(styles.field)}>
                  Remote
                  <ChoiceSelect
                    label="Push remote"
                    value={remote}
                    choices={targets.remotes.map((item) => ({
                      value: item.name,
                      label: item.name,
                    }))}
                    onChange={(value) => {
                      if (!pushBusy.current) setRemote(value);
                    }}
                  />
                </div>
                <label {...stylex.props(styles.field)}>
                  Destination branch
                  <input
                    aria-label="Destination branch"
                    value={branch}
                    disabled={pushing}
                    list={branchList}
                    onChange={(event) => setBranch(event.target.value)}
                    {...stylex.props(ui.input)}
                  />
                </label>
                <datalist id={branchList}>
                  {destination?.branches.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </datalist>
                <p {...stylex.props(styles.hint)}>
                  {existing
                    ? "Update the existing branch."
                    : "Use an existing branch name or create a new branch."}{" "}
                  The push must be a fast-forward.
                </p>
              </>
            ) : (
              <p {...stylex.props(styles.hint)}>No remote is configured for this repository.</p>
            )}
            {error && (
              <p role="alert" {...stylex.props(styles.hint)}>
                {error}
              </p>
            )}
            <div {...stylex.props(styles.actions)}>
              <Dialog.Close {...stylex.props(ui.button)} disabled={pushing}>
                Cancel
              </Dialog.Close>
              <button
                {...stylex.props(ui.button, ui.primary, ui.pressable)}
                disabled={pushing || !remote || !branch.trim()}
                onClick={() => void publish()}
              >
                {pushing ? "Pushing…" : `Push to ${remote || "remote"}`}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {published && (
        <span role="status" {...stylex.props(styles.published)}>
          <Icon name="check" size={14} />
          {published}
        </span>
      )}
    </>
  );
}
const styles = stylex.create({
  positioner: { zIndex: 105, outline: "none" },
  trigger: { gap: 4, minWidth: 0, paddingInlineEnd: 5 },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  baseLabel: { color: tokens.faint, fontWeight: 450 },
  chevron: { display: "inline-flex", color: tokens.faint },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    marginBottom: 2,
    paddingInline: 8,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.faint,
  },
  filterInput: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    "::placeholder": { color: tokens.faint },
  },
  groupLabel: {
    paddingInline: 8,
    paddingTop: 8,
    paddingBottom: 3,
  },
  ref: { gap: 12 },
  refName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  current: { display: "inline-flex", color: tokens.accent, flexShrink: 0 },
  menu: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    maxHeight: 380,
    overflowY: "auto",
    minWidth: 260,
    maxWidth: 460,
  },
  backdrop: { zIndex: 110 },
  dialog: {
    position: "fixed",
    top: "20vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(440px, 90vw)",
    boxSizing: "border-box",
    padding: 20,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    color: tokens.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    outline: "none",
    fontFamily: tokens.ui,
  },
  title: { margin: 0, fontSize: 14, fontWeight: 550 },
  hint: { fontSize: 12, color: tokens.muted, lineHeight: 1.5, marginBlock: 6 },
  menuHint: {
    fontSize: 11.5,
    color: tokens.faint,
    lineHeight: 1.5,
    marginBlock: 6,
    paddingInline: 8,
  },
  repo: {
    fontFamily: tokens.code,
    fontSize: 11,
    overflowWrap: "anywhere",
    color: tokens.faint,
    marginBlock: 12,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 6,
    marginBlock: 14,
    fontSize: 12,
    color: tokens.muted,
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  published: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginInlineStart: 6,
    color: tokens.green,
    fontSize: 12,
    whiteSpace: "nowrap",
  },
});
